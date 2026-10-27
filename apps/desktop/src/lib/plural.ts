export const pluralize = (count: number, noun: string) =>
  `${count} ${count === 1 ? noun : `${noun}s`}`;
