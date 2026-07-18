import { db } from './config/database.js';

async function run() {
  const snap = await db.collection('map_points').get();
  const rawPoints = snap.docs.map(d => d.data());

  const counts: Record<string, number> = {};
  rawPoints.forEach((p: any) => {
    const type = p.incident_type || '';
    if (type) {
      counts[type] = (counts[type] || 0) + 1;
    }
  });

  const rawTypes = Object.keys(counts);

  // Grouping logic
  const normalizedGroups: Record<string, { standard_name: string; aliases: string[]; total_occurrences: number }> = {};

  function addToGroup(standardName: string, rawName: string) {
    const count = counts[rawName] || 0;
    if (!normalizedGroups[standardName]) {
      normalizedGroups[standardName] = {
        standard_name: standardName,
        aliases: [],
        total_occurrences: 0
      };
    }
    if (!normalizedGroups[standardName].aliases.includes(rawName)) {
      normalizedGroups[standardName].aliases.push(rawName);
    }
    normalizedGroups[standardName].total_occurrences += count;
  }

  rawTypes.forEach(raw => {
    const rawClean = raw.trim();
    const rawLower = rawClean.toLowerCase();

    // 1. Theft (excl. Qualified)
    if (rawLower === 'theft' || rawLower === 'theft - rpc art. 308' || rawLower === 'theft  - rpc art. 308') {
      addToGroup('Theft', raw);
    }
    // 2. Qualified Theft
    else if (rawLower.includes('qualified theft')) {
      addToGroup('Qualified Theft', raw);
    }
    // 3. Robbery
    else if (rawLower === 'robbery' || rawLower === 'robbery - rpc art. 293' || rawLower === 'robbery  - rpc art. 293') {
      addToGroup('Robbery', raw);
    }
    // 4. Homicide (excl. Reckless Imprudence)
    else if (rawLower === 'homicide' || rawLower === 'homicide - rpc art. 249' || rawLower === 'homicide  - rpc art. 249') {
      addToGroup('Homicide', raw);
    }
    // 5. Murder
    else if (rawLower === 'murder' || rawLower === 'murder - rpc art. 248' || rawLower === 'murder  - rpc art. 248') {
      addToGroup('Murder', raw);
    }
    // 6. Comprehensive Dangerous Drugs Act (RA 9165)
    else if (
      rawLower.includes('dangerous drugs act') || 
      rawLower.includes('comprehensive dangerous drugs act')
    ) {
      addToGroup('Comprehensive Dangerous Drugs Act (RA 9165)', raw);
    }
    // 7. Child Abuse (RA 7610)
    else if (
      rawLower.includes('child abuse') || 
      rawLower.includes('anti-child abuse') || 
      rawLower.includes('special protection of children against child abuse')
    ) {
      addToGroup('Child Abuse (RA 7610)', raw);
    }
    // 8. Anti-VAWC (RA 9262)
    else if (
      rawLower.includes('anti-vawc') || 
      rawLower.includes('vawc') || 
      rawLower.includes('violence against women')
    ) {
      addToGroup('Anti-VAWC (RA 9262)', raw);
    }
    // 9. Safe Spaces Act (RA 11313)
    else if (
      rawLower.includes('safe spaces act') || 
      rawLower.includes('gender based sexual harassment')
    ) {
      addToGroup('Safe Spaces Act (RA 11313)', raw);
    }
    // 10. Carnapping (Motorcycle)
    else if (
      rawLower.includes('carnapping (motorcycle)') || 
      (rawLower.includes('carnapping') && rawLower.includes('- mc'))
    ) {
      addToGroup('Carnapping (Motorcycle)', raw);
    }
    // 11. Carnapping (Regular)
    else if (rawLower === 'carnapping') {
      addToGroup('Carnapping', raw);
    }
    // 12. Reckless Imprudence Resulting to Homicide
    else if (rawLower.includes('reckless imprudence') && rawLower.includes('homicide')) {
      addToGroup('Reckless Imprudence Resulting to Homicide', raw);
    }
    // 13. Reckless Imprudence Resulting to Physical Injury
    else if (rawLower.includes('reckless imprudence') && rawLower.includes('physical injury')) {
      addToGroup('Reckless Imprudence Resulting to Physical Injury', raw);
    }
    // 14. Reckless Imprudence Resulting to Damage to Property
    else if (rawLower.includes('reckless imprudence') && rawLower.includes('damage to property')) {
      addToGroup('Reckless Imprudence Resulting to Damage to Property', raw);
    }
    // 15. Other offenses - handle remaining
    else {
      // General fallbacks
      // Let's standardise the rest to capitalized standard format without rpc and ra refs where possible
      let std = rawClean;
      // strip " - RPC Art. ..."
      std = std.replace(/\s*-\s*RPC\s+Art\s*\.?\s*\d+.*/gi, '');
      std = std.replace(/\s*-\s*RA\s+\d+.*/gi, '');
      std = std.replace(/\s*-\s*PD\s+\d+.*/gi, '');
      // capitalise first letter of words, or keep standard casing
      addToGroup(std, raw);
    }
  });

  const output = {
    normalized_offenses: Object.values(normalizedGroups).sort((a, b) => b.total_occurrences - a.total_occurrences)
  };

  console.log(JSON.stringify(output, null, 2));
}

run().catch(console.error);
