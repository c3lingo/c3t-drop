import sortTitle from '../sort-title';

describe('sortTitle', () => {
  it('returns a lowercase title with common words removed', () => {
    expect(sortTitle('Der Keks')).toEqual('keks');
    expect(sortTitle('The The')).toEqual('the');
    expect(sortTitle('A Solution to the Travelling Salesman Problem')).toEqual(
      'solution to the travelling salesman problem'
    );
    expect(sortTitle('THEOLOGISCHE ZUGÄNGE ZU NYANCAT')).toEqual('theologische zugänge zu nyancat');
    expect(sortTitle('Derivatives')).toEqual('derivatives');
    expect(sortTitle('Dienstag')).toEqual('dienstag');
  });

  it('removes non-letter characters', () => {
    expect(sortTitle('📊 GIRLS JUST WANNA HAVE SOME STATS')).toEqual(
      'girls just wanna have some stats'
    );
    expect(sortTitle('37C3 カラオケ – Herausforderungen der aktuellen Karaokeforschung')).toEqual(
      '37c3 カラオケ herausforderungen der aktuellen karaokeforschung'
    );
  });
});
