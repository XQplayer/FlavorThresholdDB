import pdfplumber
import os
import re
import json

base_dir = r"d:\antigravity project\香气阈值小程序"
pdfs = ["PART 1-空气.pdf", "PART 2 -水.pdf", "PART 3 -其他介质.pdf"]

all_refs = {}

for pdf_name in pdfs:
    pdf_path = os.path.join(base_dir, pdf_name)
    print(f"Processing {pdf_name} geometrically...")
    with pdfplumber.open(pdf_path) as pdf:
        total_pages = len(pdf.pages)
        in_references = False
        
        for i in range(max(0, total_pages - 40), total_pages):
            page = pdf.pages[i]
            
            # Use quick text to check if we are in references
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
                
                # Extract all non-blank character bounding boxes
                chars = [c for c in cropped.chars if c['text'].strip()]
                if not chars:
                    continue
                
                # Sort characters top to bottom, left to right
                chars.sort(key=lambda c: (round(c['top']), c['x0']))
                
                # Group characters into visual lines
                lines = []
                current_line_chars = []
                current_y0 = -1
                
                for c in chars:
                    if current_y0 == -1 or abs(c['top'] - current_y0) > 4:
                        if current_line_chars:
                            lines.append(current_line_chars)
                        current_line_chars = [c]
                        current_y0 = c['top']
                    else:
                        current_line_chars.append(c)
                
                if current_line_chars:
                    lines.append(current_line_chars)
                    
                # Now group lines into blocks/paragraphs based on geometric gap
                blocks = []
                current_block = [lines[0]]
                
                for j in range(1, len(lines)):
                    prev_line = lines[j-1]
                    curr_line = lines[j]
                    
                    prev_bottom = max(c['bottom'] for c in prev_line)
                    curr_top = min(c['top'] for c in curr_line)
                    
                    # If gap between bottom of prev line and top of curr line is > 3.0 pts
                    # It's an empty line / paragraph break!
                    gap = curr_top - prev_bottom
                    if gap > 3.0:
                        blocks.append(current_block)
                        current_block = [curr_line]
                    else:
                        current_block.append(curr_line)
                
                if current_block:
                    blocks.append(current_block)
                
                # Assemble text for each block
                for block in blocks:
                    block_text_lines = []
                    for line_chars in block:
                        # Reconstruct text with spaces based on x0 distances if necessary, 
                        # but simplistic joining is fine if we just extract_text on the bounding box of the line
                        # Or let's just use cropped.extract_text(layout=True) but since we know the block boundaries...
                        # Better yet, just use cropped.extract_text() for the combined bounding box of the block!
                        x0 = min(c['x0'] for c in line_chars)
                        y0 = min(c['top'] for c in line_chars)
                        x1 = max(c['x1'] for c in line_chars)
                        y1 = max(c['bottom'] for c in line_chars)
                        # We can just join characters
                        
                        # A better way to get spaces accurately: 
                        # just join characters adding space if gap between x1 and next x0 > 2.0
                        line_chars.sort(key=lambda c: c['x0'])
                        text = line_chars[0]['text']
                        for k in range(1, len(line_chars)):
                            c_prev = line_chars[k-1]
                            c_curr = line_chars[k]
                            if c_curr['x0'] - c_prev['x1'] > 1.5:
                                text += ' '
                            text += c_curr['text']
                        block_text_lines.append(text)
                    
                    full_ref = ' '.join(block_text_lines)
                    full_ref = re.sub(r'\s+', ' ', full_ref).strip()
                    
                    # Skip common headers
                    if "REFERENCES" in full_ref.upper() and len(full_ref) < 30: continue
                    if full_ref.lower() == "references": continue
                    if re.match(r'^\d+$', full_ref): continue
                    if "ODOR THRESHOLD" in full_ref.upper(): continue
                    if "COMPILATIONS OF ODOUR" in full_ref.upper(): continue
                    if re.match(r'^[A-Z]$', full_ref): continue # A, B, C section headers
                    
                    year_match = re.search(r'\(\d{4}[a-z]?\)', full_ref)
                    if year_match:
                        # The key is everything up to the first year match
                        key = full_ref[:year_match.end()].strip()
                        all_refs[key] = full_ref

print(f"\nExtracted {len(all_refs)} unique references based on geometric paragraphs.")

# Stats
long_refs = sum(1 for v in all_refs.values() if len(v) > 350)
print(f"References > 350 chars (possibly multi-refs or safe double-citations): {long_refs}")

check_authors = ['APPELL', 'ARCO', 'ARENA', 'NAUS', 'COMETTO-MUÑIZ', 'ZAPP', 'ZIBIREVA']
for author in check_authors:
    matches = [k for k in all_refs.keys() if author in k]
    print(f"{author}: {len(matches)} -> {matches[:3]}")

output_path = os.path.join(base_dir, "references.json")
with open(output_path, "w", encoding="utf-8") as f:
    json.dump(all_refs, f, ensure_ascii=False, indent=2)

print(f"Saved geometrically perfect {output_path}")
