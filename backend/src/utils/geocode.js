"use strict";

const LOCATION_TABLE = {
  // Africa
  africa:               { lat:  -8.8,    lng:  26.0 },
  kenya:                { lat:  -0.0236, lng:  37.9062 },
  nigeria:              { lat:   9.082,  lng:   8.6753 },
  ghana:                { lat:   7.946,  lng:  -1.023 },
  ethiopia:             { lat:   9.145,  lng:  40.489 },
  tanzania:             { lat:  -6.369,  lng:  34.889 },
  uganda:               { lat:   1.373,  lng:  32.290 },
  mozambique:           { lat: -18.665,  lng:  35.529 },
  madagascar:           { lat: -18.767,  lng:  46.869 },
  cameroon:             { lat:   3.848,  lng:  11.502 },
  "dr congo":           { lat:  -4.038,  lng:  21.759 },
  "democratic republic of congo": { lat: -4.038, lng: 21.759 },
  congo:                { lat:  -0.228,  lng:  15.827 },
  senegal:              { lat:  14.497,  lng: -14.452 },
  "south africa":       { lat: -30.560,  lng:  22.937 },
  zambia:               { lat: -13.133,  lng:  27.849 },
  malawi:               { lat: -13.254,  lng:  34.302 },
  rwanda:               { lat:  -1.940,  lng:  29.874 },
  "east africa":        { lat:  -1.0,    lng:  37.0 },
  "west africa":        { lat:  12.0,    lng:  -2.0 },
  "sub-saharan africa": { lat:  -5.0,    lng:  22.0 },

  // Americas
  brazil:               { lat: -14.235,  lng: -51.925 },
  "amazon basin":       { lat:  -3.465,  lng: -62.215 },
  amazon:               { lat:  -3.465,  lng: -62.215 },
  colombia:             { lat:   4.571,  lng: -74.297 },
  peru:                 { lat:  -9.190,  lng: -75.015 },
  ecuador:              { lat:  -1.832,  lng: -78.183 },
  bolivia:              { lat: -16.290,  lng: -63.589 },
  argentina:            { lat: -38.416,  lng: -63.617 },
  chile:                { lat: -35.675,  lng: -71.543 },
  venezuela:            { lat:   6.424,  lng: -66.590 },
  "costa rica":         { lat:   9.748,  lng: -83.753 },
  mexico:               { lat:  23.634,  lng: -102.553 },
  "central america":    { lat:  15.0,    lng: -86.0 },
  "south america":      { lat: -14.235,  lng: -51.925 },
  "latin america":      { lat:  -5.0,    lng: -60.0 },
  "north america":      { lat:  54.526,  lng: -105.255 },
  canada:               { lat:  56.130,  lng: -106.347 },
  usa:                  { lat:  37.090,  lng:  -95.713 },
  "united states":      { lat:  37.090,  lng:  -95.713 },
  "united states of america": { lat: 37.090, lng: -95.713 },
  alaska:               { lat:  64.200,  lng: -153.500 },

  // Asia
  india:                { lat:  20.594,  lng:  78.963 },
  indonesia:            { lat:  -0.789,  lng: 113.921 },
  bangladesh:           { lat:  23.685,  lng:  90.356 },
  myanmar:              { lat:  21.916,  lng:  95.956 },
  cambodia:             { lat:  12.566,  lng: 104.991 },
  vietnam:              { lat:  14.058,  lng: 108.277 },
  thailand:             { lat:  15.870,  lng: 100.993 },
  laos:                 { lat:  19.856,  lng: 102.495 },
  philippines:          { lat:  12.879,  lng: 121.775 },
  borneo:               { lat:   0.961,  lng: 114.550 },
  "southeast asia":     { lat:   5.0,    lng: 108.0 },
  china:                { lat:  35.861,  lng: 104.195 },
  nepal:                { lat:  28.395,  lng:  84.124 },
  "sri lanka":          { lat:   7.873,  lng:  80.772 },
  pakistan:             { lat:  30.375,  lng:  69.345 },
  japan:                { lat:  36.205,  lng: 138.253 },
  "south korea":        { lat:  35.908,  lng: 127.767 },
  asia:                 { lat:  34.047,  lng: 100.620 },
  "central asia":       { lat:  41.20,   lng:  63.19 },

  // Middle East
  jordan:               { lat:  30.585,  lng:  36.238 },
  israel:               { lat:  31.047,  lng:  34.852 },
  "middle east":        { lat:  29.0,    lng:  41.0 },

  // Europe
  europe:               { lat:  54.526,  lng:  15.255 },
  france:               { lat:  46.228,  lng:   2.214 },
  germany:              { lat:  51.166,  lng:  10.452 },
  "united kingdom":     { lat:  55.378,  lng:  -3.436 },
  uk:                   { lat:  55.378,  lng:  -3.436 },
  spain:                { lat:  40.463,  lng:  -3.749 },
  italy:                { lat:  41.872,  lng:  12.567 },
  portugal:             { lat:  39.400,  lng:  -8.224 },
  sweden:               { lat:  60.128,  lng:  18.644 },
  norway:               { lat:  60.472,  lng:   8.469 },
  finland:              { lat:  61.925,  lng:  25.748 },
  netherlands:          { lat:  52.133,  lng:   5.291 },
  switzerland:          { lat:  46.818,  lng:   8.228 },
  ukraine:              { lat:  48.380,  lng:  31.165 },
  poland:               { lat:  51.920,  lng:  19.145 },
  scandinavia:          { lat:  64.0,    lng:  17.0 },

  // Oceania
  australia:            { lat: -25.274,  lng: 133.775 },
  "new zealand":        { lat: -40.901,  lng: 172.886 },
  "papua new guinea":   { lat:  -6.315,  lng: 143.956 },
  oceania:              { lat: -22.0,    lng: 140.0 },
  pacific:              { lat: -15.0,    lng: -140.0 },

  // Ocean / Global
  "great barrier reef": { lat: -18.286,  lng: 147.700 },
  "coral triangle":     { lat:  -2.0,    lng: 125.0 },
  arctic:               { lat:  78.0,    lng:  15.0 },
  antarctic:            { lat: -80.0,    lng:   0.0 },
  global:               { lat:  20.0,    lng:   0.0 },
  worldwide:            { lat:  20.0,    lng:   0.0 },
};

const KEYWORD_FALLBACKS = [
  ["africa",        { lat:  -8.8,   lng:  26.0 }],
  ["amazon",        { lat:  -3.465, lng: -62.215 }],
  ["south america", { lat: -14.235, lng: -51.925 }],
  ["latin america", { lat:  -5.0,   lng: -60.0 }],
  ["north america", { lat:  54.526, lng: -105.255 }],
  ["central america",{ lat: 15.0,   lng: -86.0 }],
  ["europe",        { lat:  54.526, lng:  15.255 }],
  ["southeast asia",{ lat:   5.0,   lng: 108.0 }],
  ["south asia",    { lat:  20.0,   lng:  77.0 }],
  ["asia",          { lat:  34.047, lng: 100.620 }],
  ["oceania",       { lat: -22.0,   lng: 140.0 }],
  ["australia",     { lat: -25.274, lng: 133.775 }],
  ["pacific",       { lat: -15.0,   lng: -140.0 }],
  ["arctic",        { lat:  78.0,   lng:  15.0 }],
  ["middle east",   { lat:  29.0,   lng:  41.0 }],
  ["global",        { lat:  20.0,   lng:   0.0 }],
];

function geocodeLocation(location = "") {
  const normalised = String(location).toLowerCase().trim();
  if (LOCATION_TABLE[normalised]) {
    return LOCATION_TABLE[normalised];
  }
  for (const [keyword, coords] of KEYWORD_FALLBACKS) {
    if (normalised.includes(keyword)) {
      return coords;
    }
  }
  return { lat: 0, lng: 0 };
}

function jitterCoords(coords, id = "", spread = 0.8) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  const latNorm = (hash & 0x3ff) / 1024;
  const lngNorm = ((hash >>> 12) & 0x3ff) / 1024;
  const latOffset = (latNorm - 0.5) * 2 * spread;
  const lngOffset = (lngNorm - 0.5) * 2 * spread;
  return {
    lat: coords.lat + latOffset,
    lng: coords.lng + lngOffset,
  };
}

module.exports = {
  geocodeLocation,
  jitterCoords,
};
