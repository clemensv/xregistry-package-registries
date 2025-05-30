const chai = require('chai');
const expect = chai.expect;

describe('Maven Simple Test', function() {
  it('should pass a basic test', function() {
    console.log('Running basic Maven test');
    expect(true).to.be.true;
  });
});
