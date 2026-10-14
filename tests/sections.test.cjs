const test = require('node:test');
const assert = require('node:assert/strict');
const { headingLevel, sectionBounds, firstExecutableLine } = require('./build/sections.js');
const m = source => ({ type:'markdown', source });
const c = source => ({ type:'code', source });
test('heading identification ignores fenced examples', () => {
  assert.equal(headingLevel('```md\n# fake\n```\n## real'), 2);
  assert.equal(headingLevel('some text'), null);
});
test('subheadings belong to the parent section', () => {
  const cs = [m('# Main'), c('a'), m('## Sub'), c('b'), m('# Next'), c('c')];
  assert.deepEqual(sectionBounds(cs, 1), [0, 4]);
  assert.deepEqual(sectionBounds(cs, 3), [2, 4]);
  assert.deepEqual(sectionBounds(cs, 4), [4, 6]);
});
test('preamble stops at the first heading', () => {
  assert.deepEqual(sectionBounds([c('x'), c('y'), m('# Intro'), c('z')], 0), [0, 2]);
});
test('first executable line skips comments and blanks', () => {
  assert.equal(firstExecutableLine('  \n# comment\n x = 1'), 3);
  assert.equal(firstExecutableLine('# just a comment'), null);
});
test('out of range rejected', () => {
  assert.throws(() => sectionBounds([c('a')], 3), RangeError);
});
