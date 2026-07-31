"""
Build a comprehensive lookup table by:
1. For each reference key, extract first author surname + year(s)
2. Generate normalized keys matching the short citation patterns found in the data
3. The frontend matching uses these normalized keys as O(1) lookup
"""
import json
import re
import unicodedata
import os

base_dir = r"d:\antigravity project\香气阈值小程序"
refs = json.load(open(os.path.join(base_dir, "references.json"), encoding="utf-8"))
data = json.load(open(os.path.join(base_dir, "aroma_data_merged.json"), encoding="utf-8"))

def norm(s):
    """Normalize: NFD decompose, strip diacritics, lowercase, collapse whitespace."""
    s = unicodedata.normalize("NFD", s)
    s = re.sub(r'[\u0300-\u036f]', '', s)
    s = s.lower().strip()
    s = re.sub(r'\s+', ' ', s)
    return s

# Step 1: Collect ALL actual short citations from the data
def extract_short_cite(th_str):
    m = re.match(r'^(.+?\(\d{4}.*?\))\s*(?:[dr]\s+)?.*$', th_str)
    if m:
        return m.group(1).strip()
    return th_str.strip()

all_cites = set()
for item in data:
    for th in item.get("threshold_data", []):
        c = extract_short_cite(th)
        if re.search(r'\(\d{4}', c):
            all_cites.add(c)

print(f"Total unique short citations in data: {len(all_cites)}")

# Step 2: For each reference, extract first-author surname and year
# Key format examples:
#   AMOORE, J.E. (1986a)
#   COMETTO-MUÑIZ, J.E. & W.S. CAIN (1993)
#   ANROOIJ, A. VAN (1931)
#   ADAMS, D.F., F.A. YOUNG & R.A. LUHR (1968)

ref_index = {}  # normalized_key -> full_text

for key, full_text in refs.items():
    year_match = re.search(r'\((\d{4}[a-z]?)\)', key)
    if not year_match:
        continue
    year = year_match.group(1)
    year_base = year[:4]
    
    # Extract first author surname (the key typically starts with "SURNAME,")
    author_part = key[:year_match.start()].strip().rstrip(',').rstrip('&').strip()
    
    # First surname is before the first comma or space+initial
    first_match = re.match(r'^([A-ZÀ-Ž][A-ZÀ-Ža-zà-ž\-\']+)', author_part)
    if not first_match:
        continue
    first_surname = first_match.group(1)
    
    # Check for VAN, DE etc. in the author part (after the surname)
    prefix_match = re.search(r'\b(VAN|DE|VON|LE|LA|DU|DI)\b', author_part[len(first_surname):], re.IGNORECASE)
    prefix = prefix_match.group(1) if prefix_match else ""
    
    # Generate normalized keys
    first_lower = norm(first_surname)
    prefix_lower = prefix.lower() if prefix else ""
    
    # Key pattern: "firstauthor (year)" normalized
    nk = f"{first_lower} ({year})"
    ref_index[nk] = full_text
    if year != year_base:
        ref_index[f"{first_lower} ({year_base})"] = full_text
    
    # With prefix: "van firstauthor (year)"
    if prefix_lower:
        ref_index[f"{prefix_lower} {first_lower} ({year})"] = full_text
        ref_index[f"{prefix_lower} {first_lower} ({year_base})"] = full_text
    
    # "et al." form
    ref_index[f"{first_lower} et al. ({year})"] = full_text
    ref_index[f"{first_lower} et al. ({year_base})"] = full_text
    if prefix_lower:
        ref_index[f"{prefix_lower} {first_lower} et al. ({year})"] = full_text
        ref_index[f"{prefix_lower} {first_lower} et al. ({year_base})"] = full_text
    
    # Two-author form: "first & second (year)" - extract second author surname
    amp_parts = re.split(r'\s*[&\&]\s*', author_part)
    if len(amp_parts) >= 2:
        second_block = amp_parts[-1].strip()
        # Find the surname in the second block (it should be an uppercase word)
        second_match = re.search(r'([A-ZÀ-Ž][A-ZÀ-Ža-zà-ž\-\']+)', second_block)
        if second_match:
            second_lower = norm(second_match.group(1))
            ref_index[f"{first_lower} & {second_lower} ({year})"] = full_text
            ref_index[f"{first_lower} & {second_lower} ({year_base})"] = full_text

print(f"Generated {len(ref_index)} normalized lookup keys")

# Step 3: Test match rate
matched = 0
unmatched_list = []
for cite in all_cites:
    nk = norm(cite)
    if nk in ref_index:
        matched += 1
    else:
        unmatched_list.append(cite)

print(f"Matched: {matched} ({matched/len(all_cites)*100:.1f}%)")
print(f"Unmatched: {len(unmatched_list)} ({len(unmatched_list)/len(all_cites)*100:.1f}%)")

# Show unmatched samples
print(f"\nUnmatched samples (first 25):")
for s in sorted(unmatched_list)[:25]:
    print(f"  {s}")

# Save the ref_index for use by the frontend
out_path = os.path.join(base_dir, "references_lookup.json")
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(ref_index, f, ensure_ascii=False, indent=2)
print(f"\nSaved {len(ref_index)} keys to {out_path}")
