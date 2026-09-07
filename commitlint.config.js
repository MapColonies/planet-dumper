module.exports = {
  extends: ['@map-colonies/commitlint-config'],
  rules: {
    'scope-enum': [2, 'always', ['deps', 'configurations']],
  },
};
