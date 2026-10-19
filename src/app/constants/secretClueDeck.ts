// src/app/constants/secretClueDeck.ts
//
// Server-side copy of the Secret Clue word deck. In 2-player mode the server
// is the only party that knows the secret word until a round is resolved, so
// the guesser can never read it out of the client bundle or network traffic.
//
// Keep in sync with CLUE_DATABASE in game/src/components/SecretClueGame.tsx.

export interface SecretClueItem {
  id: string;
  word: string;
  category: string;
  clues: [string, string, string, string];
  funFact?: string;
}

export const SECRET_CLUE_DECK: SecretClueItem[] = [
  {
    "id": "w-1",
    "word": "MATCH",
    "category": "Connection",
    "clues": [
      "A mutual spark ignited between two profiles on a digital dating network.",
      "A slender wooden splint tipped with sulfur struck against red phosphorus.",
      "A competitive athletic fixture contested between two determined rivals.",
      "Two corresponding items sharing identical symmetry, color, or design."
    ],
    "funFact": "Matches were accidentally invented by John Walker in 1826 while scraping a chemical stick."
  },
  {
    "id": "w-2",
    "word": "CHEMISTRY",
    "category": "Science & Soul",
    "clues": [
      "An unvoiced magnetic electricity felt across a quiet candlelit table.",
      "The empirical physical science studying atoms, molecular bonds, and reactions.",
      "The intricate neurological surge of dopamine, serotonin, and oxytocin.",
      "The seamless subconscious synchrony that unites a championship sports squad."
    ],
    "funFact": "The chemical phenylethylamine triggers the unmistakable feeling of instant chemistry."
  },
  {
    "id": "w-3",
    "word": "PASSPORT",
    "category": "Voyage",
    "clues": [
      "A gilded booklet essential to cross beyond sovereign national borders.",
      "Fitted with biometric microchips, visa watermark leaves, and consular seals.",
      "Derived from medieval harbor documents granting safe passage through port gates.",
      "Renewed every decade, bearing your unsmiling neutral portrait."
    ],
    "funFact": "King Henry V of England is credited with inventing the earliest recorded safe-conduct passport."
  },
  {
    "id": "w-4",
    "word": "AURORA",
    "category": "Cosmos",
    "clues": [
      "Fluorescent ribbons of emerald and violet undulating through polar night skies.",
      "Solar wind ions colliding with oxygen and nitrogen in the upper atmosphere.",
      "Named after the ancient Roman goddess who personified the rising dawn.",
      "Witnessed clearest near geomagnetic poles during high solar flare activity."
    ],
    "funFact": "Oxygen emits the iconic vibrant green glow at altitudes between 60 and 150 miles."
  },
  {
    "id": "w-5",
    "word": "COFFEE",
    "category": "Culinary",
    "clues": [
      "A dark aromatic brew credited with energizing modern thinkers and dawn meetings.",
      "Legend attributes its discovery to an Ethiopian goat herder named Kaldi.",
      "Extracted under nine bars of espresso pressure or slow-dripped through paper filters.",
      "The world second most traded agricultural export alongside crude oil and tea."
    ],
    "funFact": "Over 2.25 billion cups of coffee are consumed globally every single day."
  },
  {
    "id": "w-6",
    "word": "COMPASS",
    "category": "Navigation",
    "clues": [
      "A magnetized needle balancing delicately upon a central brass pivot.",
      "Guides navigators toward geomagnetic polar pull rather than true geographic north.",
      "First invented during China Han dynasty as an early geomantic divining tool.",
      "Encircled by thirty-two traditional points radiating upon a mariner windrose."
    ],
    "funFact": "Earth magnetic north shifts approximately 30 miles every year toward Siberia."
  },
  {
    "id": "w-7",
    "word": "ORCHESTRA",
    "category": "Music",
    "clues": [
      "Eighty acoustic instruments breathing as one under a single silent baton.",
      "Partitioned into strings, woodwinds, brass, and thunderous percussion.",
      "Derived from the ancient Athenian circular stage area reserved for choruses.",
      "Tunes harmoniously to the principal oboe pitch at 440 vibrations per second."
    ],
    "funFact": "The modern symphony orchestra evolved into its standardized four-section form in the 1700s."
  },
  {
    "id": "w-8",
    "word": "MOONLIGHT",
    "category": "Cosmos",
    "clues": [
      "Reflected solar rays mirrored across nearly a quarter-million miles of space.",
      "Bounces softly off cratered basalt maria and powdery lunar regolith.",
      "Guides nocturnal hatchlings toward safety along open oceanic surf.",
      "Controls the cyclic rhythm of ocean tides via gravitational tidal force."
    ],
    "funFact": "The moon surface reflects only about 12% of the sunlight striking it."
  },
  {
    "id": "w-9",
    "word": "DIAMOND",
    "category": "Geology",
    "clues": [
      "Pure elemental carbon crystalline forged under immense mantle compression.",
      "Occupies the peak rating of ten on Friedrich Mohs mineral hardness scale.",
      "Customarily set into bridal bands since Archduke Maximilian of Austria in 1477.",
      "Cut into fifty-seven precision facets to maximize refractive internal sparkle."
    ],
    "funFact": "Most natural diamonds were formed between one and three billion years ago."
  },
  {
    "id": "w-10",
    "word": "WHISPER",
    "category": "Communication",
    "clues": [
      "An unvoiced speech acoustic produced without vibration of the vocal folds.",
      "The quiet intimate medium of pillow talk, palace conspiracies, and study halls.",
      "Registers consistently below thirty decibels on sound level meters.",
      "Formed solely by turbulent airflow slipping softly past parted lips and tongue."
    ],
    "funFact": "Whispering actually expends more vocal effort and air volume than normal speech."
  },
  {
    "id": "w-11",
    "word": "ARCHIVE",
    "category": "History",
    "clues": [
      "A climate-controlled chamber safeguarding centuries of parchment memories.",
      "Derived from ancient Athenian public records kept in the magistrate house.",
      "Protects historical treaties, original patent blue-prints, and film negatives.",
      "Digital vaults preserving deprecated source code and historical git repositories."
    ],
    "funFact": "The Vatican Secret Archives contain 53 linear miles of historical shelving."
  },
  {
    "id": "w-12",
    "word": "ANCHOR",
    "category": "Maritime",
    "clues": [
      "A forged iron hook gripping the seabed to tether vessels against storm surges.",
      "Emblazoned on naval tattoos as a universal symbol of steadfast hope.",
      "Connected to massive cast-steel stud links rattling through the hawsepipe.",
      "The veteran journalist who grounds and stabilizes a prime-time news broadcast."
    ],
    "funFact": "An anchor on a ship can weigh upwards of 30 tons on modern aircraft carriers."
  },
  {
    "id": "w-13",
    "word": "ECLIPSE",
    "category": "Sky",
    "clues": [
      "A celestial alignment casting an umbral shadow across the daytime world.",
      "Temporarily unveils the sun ghostly solar corona to terrestrial observers.",
      "Ancient warring armies laid down arms in terror when day turned suddenly to dusk.",
      "Can manifest as total, annular ring of fire, or blood-tinted lunar darkness."
    ],
    "funFact": "The next total solar eclipse visible from mainland Europe will occur in 2026."
  },
  {
    "id": "w-14",
    "word": "TREASURE",
    "category": "Adventure",
    "clues": [
      "Marked by an enigmatic X upon faded parchment nautical charts.",
      "Concealed within iron-strapped oak chests buried deep beneath coastal dunes.",
      "Salvaged from sunken seventeenth-century Spanish galleons by deep-sea probes.",
      "Metaphorically, anything profoundly cherished, valued, and fiercely safeguarded."
    ],
    "funFact": "Over three million shipwrecks with lost cargo lie scattered on ocean floors."
  },
  {
    "id": "w-15",
    "word": "LANTERN",
    "category": "Illumination",
    "clues": [
      "A protective enclosure sheltering a living flame or filament from howling wind.",
      "Used by Paul Revere compatriots to signal troop movements from the Old North steeple.",
      "Crafted from pierced tinplate, stained glass panels, or oiled rice paper.",
      "Lifted by the thousands into autumn midnight skies during eastern lantern festivals."
    ],
    "funFact": "Paper lanterns were initially deployed in the 3rd century BCE as military signals."
  },
  {
    "id": "w-16",
    "word": "MIRAGE",
    "category": "Atmosphere",
    "clues": [
      "An optical illusion of shimmering water glistening over sunbaked pavement.",
      "Caused by thermal atmospheric refraction bending light across heated ground.",
      "Frequently deceived weary desert caravans into chasing non-existent pools.",
      "Can project maritime ghost ships floating upside down above ocean horizons."
    ],
    "funFact": "The complex superior mirage called Fata Morgana can make coastlines appear as castles."
  },
  {
    "id": "w-17",
    "word": "SYMPHONY",
    "category": "Sound",
    "clues": [
      "An extended four-movement sonata composition for full concert orchestra.",
      "Beethoven penned his immortal choral ninth while entirely devoid of hearing.",
      "Traces its etymology to ancient Greek syn (together) and phone (voice).",
      "Begins with sonata allegro, wanders into adagio, and climaxes in a stirring coda."
    ],
    "funFact": "Joseph Haydn is known as the Father of the Symphony, having composed 106 of them."
  },
  {
    "id": "w-18",
    "word": "TELESCOPE",
    "category": "Discovery",
    "clues": [
      "Trained toward Jupiter in 1610 to reveal four previously unseen planetary moons.",
      "Utilizes curved objective glass lenses or parabolic mirrors to collect photons.",
      "Equipped aboard James Webb and Hubble to capture primordial cosmic nebulae.",
      "Allows astronomers on Earth to peer billions of light-years into the universe dawn."
    ],
    "funFact": "The James Webb Space Telescope primary mirror is coated in pure vaporized gold."
  },
  {
    "id": "w-19",
    "word": "AVALANCHE",
    "category": "Alpine",
    "clues": [
      "A torrential sweep of packed snow and ice plunging down mountain couloirs.",
      "Can accelerate past eighty miles per hour, generating an immense blast of wind.",
      "Triggered by temperature shifts, structural snowpack weakness, or stray vibrations.",
      "Figuratively denotes an uncontrollable avalanche of incoming demands."
    ],
    "funFact": "Over 90% of avalanche victims trigger the slide themselves."
  },
  {
    "id": "w-20",
    "word": "CANDLE",
    "category": "Warmth",
    "clues": [
      "A braided cotton wick embedded within beeswax, paraffin, or scented soy.",
      "Puffed out on celebratory birthday cakes following a secret silent wish.",
      "Hand-dipped for centuries by traditional European monasteries and chandlers.",
      "Pools into soothing liquid wax while illuminating romantic evening tables."
    ],
    "funFact": "Ancient Romans made early candles by dipping rolled papyrus into melted tallow."
  },
  {
    "id": "w-21",
    "word": "HORIZON",
    "category": "Vista",
    "clues": [
      "The illusory line where the curvature of the earth appears to meet the open sky.",
      "Constantly retreats into the far distance as an observer advances forward.",
      "Roughly three miles away for a person standing upright at sea level.",
      "In gravitational astrophysics, marks the boundary beyond which light cannot return."
    ],
    "funFact": "At 35,000 feet on an airplane, the visual horizon extends over 220 miles away."
  },
  {
    "id": "w-22",
    "word": "ORIGAMI",
    "category": "Artistry",
    "clues": [
      "The historic Japanese art of transforming flat squares of paper into paper cranes.",
      "Adheres to strict discipline utilizing geometric creases without scissors or glue.",
      "Practiced since the Edo era as ceremonial art and mindful spatial focus.",
      "Inspires mechanical folding of spacecraft solar arrays and medical heart stents."
    ],
    "funFact": "Senbazuru is the ancient Japanese legend that folding 1,000 cranes grants a wish."
  },
  {
    "id": "w-23",
    "word": "VOLCANO",
    "category": "Geology",
    "clues": [
      "A breach in the lithosphere expelling molten magma, sulfur, and volcanic ash.",
      "Forged the Hawaiian archipelago as the Pacific tectonic plate drifted over a hotspot.",
      "Named for the ancient Roman patron god of blacksmithing and fiery forge.",
      "Capable of lying dormant for thousands of years before sudden cataclysmic fury."
    ],
    "funFact": "Olympus Mons on Mars is the largest known volcano in the entire solar system."
  },
  {
    "id": "w-24",
    "word": "BALLOON",
    "category": "Aviation",
    "clues": [
      "The Montgolfier brothers took flight across the Parisian sky inside one in 1783.",
      "Relies on lighter-than-air hot gas or buoyant helium to achieve passive lift.",
      "Twisted into miniature colorful animals by buskers at children street fairs.",
      "Ascends into the stratosphere carrying radiosondes for meteorological forecasts."
    ],
    "funFact": "Rubber toy balloons were invented in 1824 by scientist Michael Faraday."
  },
  {
    "id": "w-25",
    "word": "MAZE",
    "category": "Mystery",
    "clues": [
      "A bewildering labyrinth of intersecting hedges engineered to confound explorers.",
      "Navigated in ancient mythology by Theseus holding Ariadne spool of golden thread.",
      "A cherished garden feature of British royal palaces and Renaissance estates.",
      "Guaranteed to be solved eventually by keeping your right hand against a continuous wall."
    ],
    "funFact": "The Hampton Court hedge maze in London has puzzled visitors since 1700."
  },
  {
    "id": "w-26",
    "word": "ISLAND",
    "category": "Geography",
    "clues": [
      "A sovereign landmass isolated by ocean waters, smaller than a continental shelf.",
      "Greenland claims the geographic crown as the largest non-continental one on Earth.",
      "Encourages unique evolutionary paths like the giant tortoises of the Galapagos.",
      "Famously reflected upon by poet John Donne: No man is an ... entire of itself."
    ],
    "funFact": "Sweden has over 267,000 islands, more than any other nation on Earth."
  },
  {
    "id": "w-27",
    "word": "SHADOW",
    "category": "Optics",
    "clues": [
      "A dark silhouette projected when an opaque body obstructs incoming light rays.",
      "Elongates dramatically during sunset golden hour and dwindles to nothing at high noon.",
      "Peter Pan lost his in the nursery until Wendy Darling sewed it back onto his foot.",
      "Ancient gnomons and sundials marked the hour solely by its rotating angle."
    ],
    "funFact": "Umbra is the darkest core of a shadow, while penumbra is the lighter outer fringe."
  },
  {
    "id": "w-28",
    "word": "KEY",
    "category": "Security",
    "clues": [
      "A notched piece of brass machined to lift lock tumblers into shear alignment.",
      "Presented ceremonially in gilded form to grant honorary freedom of a city.",
      "In cryptography, a cryptographic cipher string unlocking encrypted data.",
      "In music theory, the foundational tonal scale centered on a tonic note."
    ],
    "funFact": "The earliest known pin-tumbler locks date back 4,000 years to ancient Khorsabad."
  },
  {
    "id": "w-29",
    "word": "CLOCK",
    "category": "Time",
    "clues": [
      "Maintains a constant escapement frequency dividing continuous time into seconds.",
      "Big Ben in Westminster Palace is among the world most iconic mechanical variants.",
      "Modern atomic standards measure time by cesium atom microwave transitions.",
      "Chimes hourly bells from village church steeples across historical towns."
    ],
    "funFact": "The word clock derives from the medieval Latin clocca, meaning bell."
  },
  {
    "id": "w-30",
    "word": "MIRROR",
    "category": "Reflection",
    "clues": [
      "A sheet of annealed float glass backed with a micro-thin layer of silver or aluminum.",
      "In mythology, Narcissus became hopelessly enchanted by his reflection in a pond.",
      "Reverses optical left and right while faithfully preserving spatial depth.",
      "Central to folklore warning against seven years of misfortune if fractured."
    ],
    "funFact": "Modern silvered-glass mirrors were invented in 1835 by German chemist Justus von Liebig."
  }
];
