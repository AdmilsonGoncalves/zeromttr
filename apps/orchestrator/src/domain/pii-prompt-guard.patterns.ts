const DDD = '(?:1[1-9]|2[12478]|3[1-578]|4[1-9]|5[1345]|6[1-9]|7[13-579]|8[1-9]|9[1-9])'; // DDDs válidos ANATEL

export const PII_PATTERNS = {
  cpfDotted: /(?<![0-9a-zA-Z])\d{3}\.\d{3}\.\d{3}-\d{2}(?![0-9a-zA-Z])/,
  cnpjDotted: /(?<![0-9a-zA-Z])\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}(?![0-9a-zA-Z])/,
  digits11: /(?<![0-9a-zA-Z])(?<!\d\.)\d{11}(?![0-9a-zA-Z])(?!\.\d)/g,
  digits14: /(?<![0-9a-zA-Z])(?<!\d\.)\d{14}(?![0-9a-zA-Z])(?!\.\d)/g,
  jwt: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}\b/,
  bearer: /\bBearer\s+(?!\[REDACTED)[A-Za-z0-9\-._~+/]{8,}=*/i,
  email:
    /(?<![A-Za-z0-9._%+-])(?!git@[A-Za-z0-9.-]+:)[A-Za-z0-9._%+-]+@(?!users\.noreply\.github\.com)[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/,
  phone: new RegExp(
    String.raw`(?:\+55\s?${DDD}\s?(?:9\d{8}|[2-5]\d{7})\b|(?:\+?55\s?)?\(${DDD}\)\s?(?:9\d{4}|[2-5]\d{3})-?\d{4}\b|(?:\+?55\s?)?\b${DDD}\s?(?:9\d{4}|[2-5]\d{3})-\d{4}\b|\b(?:pix|tel|cel|fone|phone|whatsapp)\b["':=\s]+(?:\+?55)?${DDD}(?:9\d{8}|[2-5]\d{7})\b)`,
    'i'
  ),
  evpPix:
    /\b(?:pix(?:_?key)?|chave_?pix|evp)\b["':=\s]+[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i
};

export const EDGE_REDACTED_PATTERN = /\[REDACTED_[A-Z0-9_]+\]/g;
