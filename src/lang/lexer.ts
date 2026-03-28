import { buildLexer } from 'typescript-parsec'

export enum Token {
  // Literals
  Number,
  Ident,

  // Keywords
  Parameters,
  Operation,

  // Multi-char operators (must precede single-char)
  Arrow,    // =>
  StarStar, // **

  // Single-char operators
  Plus,
  Minus,
  Star,
  Slash,
  Percent,
  Eq,
  Lt,
  Dot,

  // Delimiters
  LParen,
  RParen,
  LBrace,
  RBrace,
  Comma,
  Colon,
  Semicolon,

  // Whitespace / comments (skipped)
  Newline,
  BlockComment,
  LineComment,
  Space,
}

export const lexer = buildLexer([
  // Comments (skipped, before operators so /* and // match first)
  [false, /^\/\*[\s\S]*?\*\//g, Token.BlockComment],
  [false, /^\/\/[^\n]*/g, Token.LineComment],

  // Multi-char operators (before single-char)
  [true, /^=>/g, Token.Arrow],
  [true, /^\*\*/g, Token.StarStar],

  // Single-char operators
  [true, /^\+/g, Token.Plus],
  [true, /^-/g, Token.Minus],
  [true, /^\*/g, Token.Star],
  [true, /^\//g, Token.Slash],
  [true, /^%/g, Token.Percent],
  [true, /^=/g, Token.Eq],
  [true, /^</g, Token.Lt],
  [true, /^\./g, Token.Dot],

  // Delimiters
  [true, /^\(/g, Token.LParen],
  [true, /^\)/g, Token.RParen],
  [true, /^\{/g, Token.LBrace],
  [true, /^\}/g, Token.RBrace],
  [true, /^,/g, Token.Comma],
  [true, /^:/g, Token.Colon],
  [true, /^;/g, Token.Semicolon],

  // Keywords (before ident, with word boundary)
  [true, /^parameters\b/g, Token.Parameters],
  [true, /^operation\b/g, Token.Operation],

  // Identifiers and numbers
  [true, /^[a-zA-Z_][a-zA-Z0-9_]*/g, Token.Ident],
  [true, /^\d+(\.\d+)?/g, Token.Number],

  // Newlines (kept as tokens for statement separation)
  [true, /^\n/g, Token.Newline],

  // Whitespace (skipped)
  [false, /^[^\S\n]+/g, Token.Space],
])
