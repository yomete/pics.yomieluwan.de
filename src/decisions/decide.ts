import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { removeBase64Prefix } from '@/utility/image';
import {
  Answers,
  Question,
  optionsForQuestion,
  versionForQuestions,
} from './questions';
import {
  confidenceForChoice,
  confidenceForPredicate,
  confidenceForScore,
  expectedLevel,
  indexOfMax,
  normalizeProbabilities,
} from './confidence';

export const DECISIONS_MODEL_DEFAULT = 'claude-haiku-5-5';

const MAX_TOKENS = 4096;

type DecisionsClient = Pick<Anthropic, 'messages'>;

export type DecisionInput =
  { image: string } |
  { text: string };

export class DecisionError extends Error {}

let client: DecisionsClient | undefined;
const getClient = () => client ??= new Anthropic();

const SYSTEM_PROMPT = [
  'You answer typed questions about one photo or one photo search query.',
  'For each question, give a probability for every option.',
  'Probabilities for one question sum to 1.',
  'Make them reflect how likely each option is to be right:',
  'put probability near 1 only when the evidence is clear,',
  'and spread it when the evidence is weak or mixed.',
  'Judge each question on its own.',
].join(' ');

const describeQuestion = (question: Question) => {
  const lines = [
    `<question name="${question.name}" type="${question.type}">`,
    question.instructions,
  ];
  switch (question.type) {
  case 'predicate':
    lines.push('Give the probability that this is true.');
    break;
  case 'choice':
    lines.push('Options:');
    Object.entries(question.choices).forEach(([key, description]) =>
      lines.push(`- ${key}: ${description}`));
    break;
  case 'score':
    lines.push('Levels, from lowest to highest:');
    Object.entries(question.levels).forEach(([key, description]) =>
      lines.push(`- ${key}: ${description}`));
    break;
  }
  lines.push('</question>');
  return lines.join('\n');
};

export const schemaForQuestions = (questions: readonly Question[]) =>
  z.object(Object.fromEntries(questions.map(question => [
    question.name,
    question.type === 'predicate'
      ? z.object({ probability: z.number() })
      : z.object({
        probabilities: z.object(Object.fromEntries(
          optionsForQuestion(question).map(option => [option, z.number()]),
        )),
      }),
  ])));

const mediaTypeForImage = (image: string) => {
  const match = image.match(/^data:(image\/[a-z]+);base64,/);
  switch (match?.[1]) {
  case 'image/png': return 'image/png';
  case 'image/webp': return 'image/webp';
  case 'image/gif': return 'image/gif';
  default: return 'image/jpeg';
  }
};

const contentForInput = (
  input: DecisionInput,
): Anthropic.ContentBlockParam => 'image' in input
  ? {
    type: 'image',
    source: {
      type: 'base64',
      media_type: mediaTypeForImage(input.image),
      data: removeBase64Prefix(input.image),
    },
  }
  : { type: 'text', text: `<query>${input.text}</query>` };

// Turn the model's raw probabilities into typed answers with confidence
export const answersFromOutput = <Q extends readonly Question[]>(
  questions: Q,
  output: Record<string, {
    probability?: number
    probabilities?: Record<string, number>
  }>,
): Answers<Q> => Object.fromEntries(questions.map(question => {
  const raw = output[question.name] ?? {};
  if (question.type === 'predicate') {
    const [probability] = normalizeProbabilities([
      raw.probability ?? 0.5,
      1 - (raw.probability ?? 0.5),
    ]);
    return [question.name, {
      type: 'predicate',
      probability,
      confidence: confidenceForPredicate(probability),
    }];
  }
  const options = optionsForQuestion(question);
  const probabilities = normalizeProbabilities(options
    .map(option => raw.probabilities?.[option] ?? 0));
  const probabilitiesByOption = Object.fromEntries(options
    .map((option, i) => [option, probabilities[i]]));
  const top = options[indexOfMax(probabilities)];
  return [question.name, question.type === 'choice'
    ? {
      type: 'choice',
      choice: top,
      probabilities: probabilitiesByOption,
      confidence: confidenceForChoice(probabilities),
    }
    : {
      type: 'score',
      score: expectedLevel(probabilities),
      level: top,
      probabilities: probabilitiesByOption,
      confidence: confidenceForScore(probabilities),
    }];
})) as Answers<Q>;

// Ask many typed questions about one image or query in a single call
export const decide = async <const Q extends readonly Question[]>({
  input,
  questions,
  model = DECISIONS_MODEL_DEFAULT,
  decisionsClient = getClient(),
}: {
  input: DecisionInput
  questions: Q
  model?: string
  decisionsClient?: DecisionsClient
}) => {
  const timeStart = Date.now();

  const response = await decisionsClient.messages.parse({
    model,
    max_tokens: MAX_TOKENS,
    system: [{
      type: 'text',
      text: [SYSTEM_PROMPT, ...questions.map(describeQuestion)].join('\n\n'),
      cache_control: { type: 'ephemeral' },
    }],
    messages: [{ role: 'user', content: [contentForInput(input)] }],
    output_config: {
      effort: 'low',
      format: zodOutputFormat(schemaForQuestions(questions)),
    },
  });

  if (response.stop_reason === 'refusal') {
    throw new DecisionError(
      `Decision refused: ${response.stop_details?.category ?? 'unknown'}`,
    );
  }
  if (!response.parsed_output) {
    throw new DecisionError(
      `Decision output missing (stop reason: ${response.stop_reason})`,
    );
  }

  return {
    answers: answersFromOutput(questions, response.parsed_output),
    model: response.model,
    version: versionForQuestions(questions),
    latencyMs: Date.now() - timeStart,
    usage: response.usage,
  };
};
