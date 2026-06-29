/**
 * Normalise les titres d’œuvres :
 * - titres tout en majuscules → casse phrase (1re lettre du titre) + retrait de (1)…(9)
 * - mots tout en majuscules dans un titre mixte → minuscules (sauf 1er mot du titre)
 * - expressions connues (Grande Abstraction, Métamorphose, etc.)
 * - retrait de (1)…(9) après « sur papier » ou « jaune »
 */

/** @param {string} text */
function nfc(text) {
  return String(text ?? '').normalize('NFC');
}

/** @param {string} word */
function lettersIn(word) {
  return [...nfc(word)].filter((c) => /\p{L}/u.test(c));
}

/** @param {string} title */
export function isAllCapsTitle(title) {
  const letters = lettersIn(title);
  if (!letters.length) return false;
  return letters.every((c) => c === c.toUpperCase() && c !== c.toLowerCase());
}

/** @param {string} word */
function isAllCapsWord(word) {
  const letters = lettersIn(word);
  if (letters.length < 2) return false;
  return letters.every((c) => c === c.toUpperCase() && c !== c.toLowerCase());
}

/** @param {string} s */
export function stripSingleDigitParens(s) {
  return nfc(s)
    .replace(/\s*\(\s*[1-9]\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const MARKERS_STRIP_PARENS = ['sur papier', 'jaune'];

/** @param {string} s */
export function stripDigitParensAfterMarkers(s) {
  let out = nfc(s);
  for (const marker of MARKERS_STRIP_PARENS) {
    const re = new RegExp(marker, 'gi');
    let match;
    while ((match = re.exec(out)) !== null) {
      const head = out.slice(0, match.index + match[0].length);
      const tail = out.slice(match.index + match[0].length).replace(/\s*\(\s*[1-9]\s*\)/g, '');
      out = head + tail;
      re.lastIndex = match.index + match[0].length;
    }
  }
  return out.replace(/\s{2,}/g, ' ').trim();
}

/** @param {string} part */
function capitalizeWordPart(part) {
  if (!part) return part;
  const lower = part.toLocaleLowerCase('fr-FR');
  return lower.charAt(0).toLocaleUpperCase('fr-FR') + lower.slice(1);
}

/** @param {string} s */
export function toTitleCaseWords(s) {
  return nfc(s)
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.split('-').map(capitalizeWordPart).join('-'))
    .join(' ');
}

/** @param {string} s */
function toSentenceCaseTitle(s) {
  const words = nfc(s).split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  return words
    .map((word, i) => {
      const lower = word
        .split('-')
        .map((p) => p.toLocaleLowerCase('fr-FR'))
        .join('-');
      return i === 0 ? capitalizeWordPart(lower) : lower;
    })
    .join(' ');
}

/**
 * @param {string} word
 * @param {number} wordIndex index du mot dans le titre (0 = premier mot)
 */
function normalizeAllCapsWord(word, wordIndex) {
  const lower = word.toLocaleLowerCase('fr-FR');
  return wordIndex === 0 ? capitalizeWordPart(lower) : lower;
}

/** @param {string} s */
export function normalizeAllCapsWordsInText(s) {
  const text = nfc(s);
  const parts = text.split(/(\s+)/);
  let wordIdx = 0;

  return parts
    .map((part) => {
      if (!part || /^\s+$/.test(part)) return part;
      const m = part.match(/^([\p{L}][\p{L}'’]*)(.*)$/su);
      if (!m) return part;
      const [, word, rest] = m;
      if (!isAllCapsWord(word)) {
        wordIdx++;
        return part;
      }
      const converted = normalizeAllCapsWord(word, wordIdx);
      wordIdx++;
      return converted + rest;
    })
    .join('');
}

/** @param {string} s */
function lowercaseMetamorphoseWords(s) {
  const text = nfc(s);
  const parts = text.split(/(\s+)/);
  let wordIdx = 0;
  return parts
    .map((part) => {
      if (!part || /^\s+$/.test(part)) return part;
      const m = part.match(/^([\p{L}][\p{L}'’]*)(.*)$/su);
      if (!m) return part;
      const [, word, rest] = m;
      if (/^métamorphoses?$/iu.test(word) && wordIdx > 0) {
        wordIdx++;
        return word.toLocaleLowerCase('fr-FR') + rest;
      }
      wordIdx++;
      return part;
    })
    .join('');
}

/** @param {string} s */
function fixKnownTitlePhrases(s) {
  return nfc(s)
    .replace(/\bGrande Abstraction\b/g, 'Grande abstraction')
    .replace(/\bSous L'orage\b/gi, "sous l'orage")
    .replace(/\bLe Paradis\b/g, 'Le paradis')
    .replace(/\bLes Damnés\b/g, 'Les damnés')
    .replace(/\bLes Damnes\b/g, 'Les damnes')
    .replace(/\bSans Titre\b/g, 'Sans titre');
}

/** @param {string} s */
export function ensureFirstLetterUpper(s) {
  const text = nfc(s);
  const m = text.match(/^(\s*[^\p{L}]*)(\p{L})(.*)$/su);
  if (!m) return text;
  const [, prefix, first, rest] = m;
  const upper = first.toLocaleUpperCase('fr-FR');
  if (first === upper) return text;
  return prefix + upper + rest;
}

/**
 * @param {string | null | undefined} title
 * @returns {string}
 */
export function normalizeWorkTitle(title) {
  let s = title == null ? '' : String(title);
  if (!s.trim()) return s;
  s = nfc(s);
  s = stripDigitParensAfterMarkers(s);
  if (isAllCapsTitle(s)) {
    s = stripSingleDigitParens(s);
    s = toSentenceCaseTitle(s);
  } else {
    s = normalizeAllCapsWordsInText(s);
  }
  s = fixKnownTitlePhrases(s);
  s = lowercaseMetamorphoseWords(s);
  s = s.replace(/\s{2,}/g, ' ').trim();
  return ensureFirstLetterUpper(s);
}

/** @deprecated utilisez normalizeWorkTitle */
export function normalizeAllCapsTitle(title) {
  return normalizeWorkTitle(title);
}
