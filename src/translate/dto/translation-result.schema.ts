import { z } from 'zod';

// Schema for dictionary examples (optional within definitions)
const DictionaryExampleSchema = z.object({
  orig: z.string().optional(),
  trans: z.string().optional(),
}).optional();

// Schema for dictionary definitions
const DictionaryDefinitionSchema = z.object({
  pos: z.string().describe('Part of Speech'),
  def: z.string().describe('Definition in target language'),
  example: DictionaryExampleSchema.describe('Optional example sentence with translation'),
});

// Schema for the dictionary part (optional)
const DictionarySchema = z.object({
  word: z.string().optional().describe('The original word analyzed'),
  phonetic: z.string().optional().describe('Phonetic transcription'),
  definitions: z.array(DictionaryDefinitionSchema).describe('List of definitions'),
}).optional();

// Schema for the context explanation part (optional)
const ContextSchema = z.object({
  word_translation: z.string().optional().describe('General translation of the word/phrase'),
  explanation: z.string().optional().describe('Explanation of the word/phrase in context, in target language'),
}).optional();

// Schema for analysis info (always present)
const AnalysisInfoSchema = z.object({
    inputType: z.enum(['word_or_phrase', 'sentence', 'fragment']).describe('Type of the input text'),
    sourceText: z.string().describe('The original input text'),
});

// Main schema for the translation result streamed by streamObject
export const TranslationResultSchema = z.object({
  analysisInfo: AnalysisInfoSchema.describe('Information about the input text analysis'),
  context: ContextSchema.describe('Contextual explanation and translation (mainly for words/phrases)'),
  dictionary: DictionarySchema.describe('Dictionary information (mainly for words/phrases)'),
  translationResult: z.string().optional().describe('Translation of the sentence'),
  fragmentError: z.string().optional().describe('Error message if the input is an unprocessable fragment'),
}).describe('The complete structured result from the AI translation and analysis');

// Type helper
export type TranslationResult = z.infer<typeof TranslationResultSchema>;
