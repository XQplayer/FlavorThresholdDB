import pdfplumber
import os
import re
import json

base_dir = r"d:\antigravity project\香气阈值小程序"
pdfs = ["PART 1-空气.pdf", "PART 2 -水.pdf", "PART 3 -其他介质.pdf"]

def is_new_ref(line, current_ref_has_year):
    # Catch cases like "VAN ANROOIJ, A. (1931)"
    if re.match(r'^(VAN|DE|VON|LE|LA|DU|DI)\s+[A-ZÀ-Ž]{2,}', line):
        if not current_ref_has_year: return False
        return True
        
    # Match uppercase word that may contain hyphens or apostrophes
    match = re.match(r'^([A-ZÀ-Ž][A-ZÀ-Ž\-\']+)', line)
    if match:
        if not current_ref_has_year:
            return False
            
        rest = line[len(match.group(1)):].strip()
        # Author followed by comma "SMITH, "
        if rest.startswith(","): return True
        # Author followed by year "SMITH (1990)"
        if re.match(r'^\(\d{4}', rest): return True
        # Author followed by ET AL "SMITH et al"
        if re.match(r'^et\s*al', rest, re.IGNORECASE): return True
        # Author followed by institution "ARCO (ARCO"
        if re.match(r'^\([A-Z]', rest): return True
        # Author followed by & "SMITH & JONES"
        if rest.startswith("&"): return True
        # Author followed by space and initial "SMITH J."
        if re.match(r'^[A-Z]\.', rest): return True
        
    # Catch "O, Y. (1990)"
    if re.match(r'^[A-ZÀ-Ž],\s*[A-ZÀ-Ž]\.', line):
        if current_ref_has_year: return True
        
    return False

all_refs = {}

for pdf_name in pdfs:
    pdf_path = os.path.join(base_dir, pdf_name)
    with pdfplumber.open(pdf_path) as pdf:
        total_pages = len(pdf.pages)
        in_references = False
        all_lines = []
        
        for i in range(max(0, total_pages - 40), total_pages):
            page = pdf.pages[i]
            full_text = page.extract_text() or ""
            if "REFERENCES" in full_text.upper() and not in_references:
                if len(full_text.split('\n')) > 5:
                    in_references = True
            
            if not in_references:
                continue
            
            w0, h0, w1, h1 = page.bbox
            mid = (w0 + w1) / 2
            
            for crop_box in [(w0, h0, mid, h1), (mid, h0, w1, h1)]:
                cropped = page.crop(crop_box)
                text = cropped.extract_text()
                if text:
                    for line in text.split('\n'):
                        stripped = line.strip()
                        if stripped:
                            all_lines.append(stripped)
                            
        # Group lines
        current_ref_lines = []
        current_has_year = True
        
        for line in all_lines:
            if "REFERENCES" in line.upper() and len(line) < 30: continue
            if "references" == line.lower().strip(): continue
            if re.match(r'^\d+$', line): continue
            if "COMPILATIONS OF ODOUR" in line.upper(): continue
            # Check for header letters like "A", "B", "C" on their own line
            if re.match(r'^[A-Z]$', line): continue
            
            if is_new_ref(line, current_has_year):
                if current_ref_lines:
                    full_ref = ' '.join(current_ref_lines)
                    full_ref = re.sub(r'\s+', ' ', full_ref).strip()
                    year_match = re.search(r'\(\d{4}[a-z]?\)', full_ref)
                    if year_match:
                        key = full_ref[:year_match.end()].strip()
                        all_refs[key] = full_ref
                current_ref_lines = [line]
                current_has_year = bool(re.search(r'\(\d{4}[a-z]?\)', line))
            else:
                if current_ref_lines:
                    current_ref_lines.append(line)
                    if not current_has_year:
                        current_has_year = bool(re.search(r'\(\d{4}[a-z]?\)', line))
                else:
                    # Very first reference
                    current_ref_lines = [line]
                    current_has_year = bool(re.search(r'\(\d{4}[a-z]?\)', line))
                    
        if current_ref_lines:
            full_ref = ' '.join(current_ref_lines)
            full_ref = re.sub(r'\s+', ' ', full_ref).strip()
            year_match = re.search(r'\(\d{4}[a-z]?\)', full_ref)
            if year_match:
                key = full_ref[:year_match.end()].strip()
                all_refs[key] = full_ref

print(f"\nExtracted {len(all_refs)} unique references.")
long_refs = sum(1 for v in all_refs.values() if len(v) > 350)
print(f"References > 350 chars (possibly polluted): {long_refs}")
print(f"Total keys extracted: {len(all_refs)}")

# Verify ARENA, APPELL, ARCO
check_authors = ['APPELL', 'ARCO', 'ARENA', 'NAUS', 'COMETTO-MUÑIZ']
for author in check_authors:
    matches = [k for k in all_refs.keys() if author in k]
    print(f"{author}: {len(matches)} -> {matches}")

with open(os.path.join(base_dir, "references.json"), "w", encoding="utf-8") as f:
    json.dump(all_refs, f, ensure_ascii=False, indent=2)
