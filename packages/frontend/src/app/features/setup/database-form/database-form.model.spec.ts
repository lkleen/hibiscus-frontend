import {
  databaseProblems,
  databaseRequestOf,
  draftOfDatabase,
  splitHostEntry,
  type DatabaseDraft,
} from './database-form.model';

const draft: DatabaseDraft = {
  host: 'hibiscus-db',
  port: '3306',
  name: 'hibiscus',
  user: 'lars',
  password: '',
};

describe('splitHostEntry', () => {
  it('splits host:port and leaves a bare host alone', () => {
    expect(splitHostEntry('db.example.com:3307')).toEqual({ host: 'db.example.com', port: '3307' });
    expect(splitHostEntry('hibiscus-db')).toEqual({ host: 'hibiscus-db', port: null });
    expect(splitHostEntry('host:abc')).toEqual({ host: 'host:abc', port: null });
  });
});

describe('databaseProblems', () => {
  it('requires the password only until one is stored', () => {
    expect(databaseProblems(draft, false)).toEqual(['password']);
    expect(databaseProblems(draft, true)).toEqual([]);
  });

  it('flags empty fields and a bad port', () => {
    expect(databaseProblems({ ...draft, host: ' ', port: '0', name: '', user: '' }, true)).toEqual([
      'host',
      'port',
      'name',
      'user',
    ]);
  });
});

describe('databaseRequestOf', () => {
  it('leaves an empty password out so the stored one is kept', () => {
    expect(databaseRequestOf(draft)).toEqual({
      host: 'hibiscus-db',
      port: 3306,
      name: 'hibiscus',
      user: 'lars',
    });
    expect(databaseRequestOf({ ...draft, password: 'pw' }).password).toBe('pw');
  });
});

describe('draftOfDatabase', () => {
  it('starts empty with the default port', () => {
    expect(draftOfDatabase(null)).toEqual({ ...draft, host: '', name: '', user: '' });
  });
});
