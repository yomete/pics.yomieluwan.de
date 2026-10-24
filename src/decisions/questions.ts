// Typed questions, modeled on OpenAI Decisions and TypeSafe primitives:
// predicate (is it true), choice (pick one), score (rate on ordered levels)

export type PredicateQuestion<N extends string = string> = {
  type: 'predicate'
  name: N
  instructions: string
};

export type ChoiceQuestion<
  N extends string = string,
  K extends string = string,
> = {
  type: 'choice'
  name: N
  instructions: string
  // Option key -> description, e.g. { night: 'Dark, artificial light' }
  choices: Record<K, string>
};

export type ScoreQuestion<
  N extends string = string,
  L extends string = string,
> = {
  type: 'score'
  name: N
  instructions: string
  // Ordered from lowest to highest: level key -> description
  levels: Record<L, string>
};

export type Question =
  PredicateQuestion |
  ChoiceQuestion |
  ScoreQuestion;

export type PredicateAnswer = {
  type: 'predicate'
  probability: number
  confidence: number
};

export type ChoiceAnswer<K extends string = string> = {
  type: 'choice'
  choice: K
  probabilities: Record<K, number>
  confidence: number
};

export type ScoreAnswer<L extends string = string> = {
  type: 'score'
  // Probability-weighted level index, so it can fall between levels
  score: number
  level: L
  probabilities: Record<L, number>
  confidence: number
};

export type AnswerFor<Q extends Question> =
  Q extends ChoiceQuestion<string, infer K> ? ChoiceAnswer<K> :
  Q extends ScoreQuestion<string, infer L> ? ScoreAnswer<L> :
  PredicateAnswer;

export type Answers<Q extends readonly Question[]> = {
  [Item in Q[number] as Item['name']]: AnswerFor<Item>
};

export const predicate = <N extends string>(
  name: N,
  instructions: string,
): PredicateQuestion<N> => ({ type: 'predicate', name, instructions });

export const choice = <N extends string, K extends string>(
  name: N,
  instructions: string,
  choices: Record<K, string>,
): ChoiceQuestion<N, K> => ({ type: 'choice', name, instructions, choices });

export const score = <N extends string, L extends string>(
  name: N,
  instructions: string,
  levels: Record<L, string>,
): ScoreQuestion<N, L> => ({ type: 'score', name, instructions, levels });

export const optionsForQuestion = (question: Question): string[] => {
  switch (question.type) {
  case 'predicate': return [];
  case 'choice': return Object.keys(question.choices);
  case 'score': return Object.keys(question.levels);
  }
};

// Stable short hash of a question set, stored with each run so that
// changing a question marks earlier answers as stale
export const versionForQuestions = (questions: readonly Question[]) => {
  const text = JSON.stringify(questions);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};
