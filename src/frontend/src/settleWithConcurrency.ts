export type SettledTaskResult<TInput, TResult> =
  | {
      input: TInput;
      status: 'fulfilled';
      value: TResult;
    }
  | {
      input: TInput;
      reason: unknown;
      status: 'rejected';
    };

export async function settleWithConcurrency<TInput, TResult>(
  inputs: TInput[],
  concurrency: number,
  task: (input: TInput, index: number) => Promise<TResult>,
  onSettled?: (progress: {
    completed: number;
    input: TInput;
    result: SettledTaskResult<TInput, TResult>;
    total: number;
  }) => void | Promise<void>,
): Promise<Array<SettledTaskResult<TInput, TResult>>> {
  if (inputs.length === 0) return [];
  const workerCount = Math.max(1, Math.min(Math.floor(concurrency) || 1, inputs.length));
  const results = new Array<SettledTaskResult<TInput, TResult>>(inputs.length);
  let cursor = 0;
  let completed = 0;

  const worker = async () => {
    while (cursor < inputs.length) {
      const index = cursor;
      cursor += 1;
      const input = inputs[index];
      let result: SettledTaskResult<TInput, TResult>;
      try {
        result = {
          input,
          status: 'fulfilled',
          value: await task(input, index),
        };
      } catch (reason) {
        result = {
          input,
          reason,
          status: 'rejected',
        };
      }
      results[index] = result;
      completed += 1;
      await onSettled?.({ completed, input, result, total: inputs.length });
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
