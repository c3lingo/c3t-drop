export const eventName: string = '37c3';

export const readCredentials: { [username: string]: string } = {
  c3lingo: '39*Aug6{Pe6F=976EcV}9Cf{eW3v4v',
  foo: 'bar',
};

// Can be local files and/or remote URLs
export const scheduleURLs: string[] = [
  'https://fahrplan.events.ccc.de/congress/2023/fahrplan/schedule.json',
];

// How often to reload remote schedule URLs
export const remoteScheduleUpdateInterval: number = 5 * 60 * 1000;

// Secret, e.g. for signing JSON Web Tokens
export const secret = 'REPLACE THIS WITH A LONG RANDOM STRING';
