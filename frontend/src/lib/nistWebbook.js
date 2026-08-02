const ORDER = ['ei_ms', 'ir', 'gc', 'vapor_pressure', 'henry_constant', 'thermochemistry'];

export function normalizeNistSections(sections = []) {
  return sections.filter(section => {
    try {
      const url = new URL(section.url);
      return url.protocol === 'https:' && url.hostname === 'webbook.nist.gov' && ORDER.includes(section.type);
    } catch {
      return false;
    }
  }).sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type));
}
