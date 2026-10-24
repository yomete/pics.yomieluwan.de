/**
 * @jest-environment node
 */
import {
  answersFromOutput,
  choice,
  confidenceForChoice,
  confidenceForPredicate,
  confidenceForScore,
  decide,
  DecisionError,
  gate,
  normalizeProbabilities,
  predicate,
  score,
  schemaForQuestions,
  versionForQuestions,
} from '@/decisions';

const QUESTIONS = [
  predicate('has_people', 'Is at least one person clearly visible?'),
  choice('time_of_day', 'When was this taken?', {
    day: 'Daylight',
    golden_hour: 'Low warm sun',
    night: 'Dark, artificial light',
  }),
  score('busyness', 'How busy is the scene?', {
    empty: 'Nothing much',
    some: 'A few elements',
    busy: 'Many elements',
    crowded: 'Packed',
  }),
] as const;

const mockClient = (response: object) => {
  const parse = jest.fn().mockResolvedValue({
    model: 'claude-haiku-5-5',
    stop_reason: 'end_turn',
    usage: { input_tokens: 1, output_tokens: 1 },
    ...response,
  });
  return { client: { messages: { parse } } as any, parse };
};

describe('Decisions', () => {
  describe('confidence', () => {
    it('is 1 when certain and 0 when even, for a choice', () => {
      expect(confidenceForChoice([1, 0, 0])).toBe(1);
      expect(confidenceForChoice([1 / 3, 1 / 3, 1 / 3])).toBeCloseTo(0);
      expect(confidenceForChoice([0.6, 0.4])).toBeCloseTo(0.2);
    });
    it('costs less for a neighbouring level than a distant one', () => {
      const near = confidenceForScore([0.7, 0.3, 0, 0]);
      const far = confidenceForScore([0.7, 0, 0, 0.3]);
      expect(near).toBeGreaterThan(far);
      expect(confidenceForScore([0, 0, 1, 0])).toBe(1);
      expect(confidenceForScore([0.25, 0.25, 0.25, 0.25])).toBeCloseTo(0);
    });
    it('uses distance from one half for a predicate', () => {
      expect(confidenceForPredicate(0.5)).toBe(0);
      expect(confidenceForPredicate(0.9)).toBeCloseTo(0.8);
      expect(confidenceForPredicate(0)).toBe(1);
    });
    it('normalizes bad probabilities', () => {
      expect(normalizeProbabilities([2, 2])).toStrictEqual([0.5, 0.5]);
      expect(normalizeProbabilities([0, 0])).toStrictEqual([0.5, 0.5]);
      expect(normalizeProbabilities([-1, NaN, 1])).toStrictEqual([0, 0, 1]);
    });
  });

  describe('answers', () => {
    it('types and scores raw output', () => {
      const answers = answersFromOutput(QUESTIONS, {
        has_people: { probability: 0.9 },
        time_of_day: {
          probabilities: { day: 0.1, golden_hour: 0.1, night: 0.8 },
        },
        busyness: {
          probabilities: { empty: 0, some: 0.5, busy: 0.5, crowded: 0 },
        },
      });
      expect(answers.has_people.probability).toBeCloseTo(0.9);
      expect(answers.time_of_day.choice).toBe('night');
      expect(answers.time_of_day.confidence).toBeCloseTo(0.7);
      expect(answers.busyness.score).toBeCloseTo(1.5);
      expect(answers.busyness.level).toBe('some');
    });
    it('fills missing options with zero', () => {
      const answers = answersFromOutput(QUESTIONS, {
        time_of_day: { probabilities: { night: 1 } },
      });
      expect(answers.time_of_day.probabilities.day).toBe(0);
      expect(answers.has_people.probability).toBe(0.5);
    });
  });

  describe('schema', () => {
    it('lists every option', () => {
      const parsed = schemaForQuestions(QUESTIONS).safeParse({
        has_people: { probability: 1 },
        time_of_day: {
          probabilities: { day: 1, golden_hour: 0, night: 0 },
        },
        busyness: {
          probabilities: { empty: 1, some: 0, busy: 0, crowded: 0 },
        },
      });
      expect(parsed.success).toBe(true);
    });
  });

  describe('version', () => {
    it('changes when a question changes', () => {
      const changed = [
        ...QUESTIONS.slice(0, 2),
        score('busyness', 'How crowded?', { low: 'Low', high: 'High' }),
      ];
      expect(versionForQuestions(QUESTIONS))
        .toBe(versionForQuestions([...QUESTIONS]));
      expect(versionForQuestions(QUESTIONS))
        .not.toBe(versionForQuestions(changed));
    });
  });

  describe('gate', () => {
    it('writes, reviews or drops', () => {
      expect(gate(0.85)).toBe('write');
      expect(gate(0.6)).toBe('review');
      expect(gate(0.2)).toBe('drop');
      expect(gate(0.6, { write: 0.5, review: 0.3 })).toBe('write');
    });
  });

  describe('decide', () => {
    it('sends the image and questions in one call', async () => {
      const { client, parse } = mockClient({
        parsed_output: {
          has_people: { probability: 0.2 },
          time_of_day: {
            probabilities: { day: 0.9, golden_hour: 0.1, night: 0 },
          },
          busyness: {
            probabilities: { empty: 1, some: 0, busy: 0, crowded: 0 },
          },
        },
      });
      const result = await decide({
        input: { image: 'data:image/jpeg;base64,abc' },
        questions: QUESTIONS,
        decisionsClient: client,
      });
      expect(parse).toHaveBeenCalledTimes(1);
      const request = parse.mock.calls[0][0];
      expect(request.model).toBe('claude-haiku-5-5');
      expect(request.system[0].text).toContain('name="time_of_day"');
      expect(request.messages[0].content[0].source.data).toBe('abc');
      expect(result.answers.time_of_day.choice).toBe('day');
      expect(result.version).toBe(versionForQuestions(QUESTIONS));
    });
    it('throws on a refusal', async () => {
      const { client } = mockClient({
        stop_reason: 'refusal',
        parsed_output: null,
      });
      await expect(decide({
        input: { text: 'beach' },
        questions: QUESTIONS,
        decisionsClient: client,
      })).rejects.toThrow(DecisionError);
    });
  });
});
