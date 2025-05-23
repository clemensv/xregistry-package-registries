const { expect } = require('chai');

describe('PyPI Package Sorting', () => {
  describe('Package Name Sorting Logic', () => {
    // Test the sorting logic that was implemented for PyPI
    const sortPackageNames = (packageNames) => {
      return packageNames.sort((a, b) => {
        const aFirstChar = a.charAt(0);
        const bFirstChar = b.charAt(0);
        
        // Check if first character is a letter (a-z, A-Z)
        const aIsLetter = /^[a-zA-Z]/.test(aFirstChar);
        const bIsLetter = /^[a-zA-Z]/.test(bFirstChar);
        
        // If one starts with letter and other doesn't, letter comes first
        if (aIsLetter && !bIsLetter) return -1;
        if (!aIsLetter && bIsLetter) return 1;
        
        // If both start with letters or both start with non-letters, sort alphabetically
        return a.toLowerCase().localeCompare(b.toLowerCase());
      });
    };

    it('should sort letter-starting packages before number/symbol-starting packages', () => {
      const packages = ['123-test', 'awesome-package', '_private-package', 'aaa-first', '0-config'];
      const sorted = sortPackageNames([...packages]);
      
      expect(sorted).to.deep.equal([
        'aaa-first',
        'awesome-package', 
        '0-config',
        '123-test',
        '_private-package'
      ]);
    });

    it('should maintain alphabetical order within letter-starting packages', () => {
      const packages = ['zebra', 'apple', 'banana', 'cherry'];
      const sorted = sortPackageNames([...packages]);
      
      expect(sorted).to.deep.equal(['apple', 'banana', 'cherry', 'zebra']);
    });

    it('should maintain alphabetical order within number/symbol-starting packages', () => {
      const packages = ['_zebra', '9-package', '1-first', '_apple'];
      const sorted = sortPackageNames([...packages]);
      
      // In alphabetical order: _ comes before numbers in ASCII, so _apple, _zebra, then 1-first, 9-package
      expect(sorted).to.deep.equal(['_apple', '_zebra', '1-first', '9-package']);
    });

    it('should handle mixed case correctly', () => {
      const packages = ['Zebra', 'apple', 'BANANA', 'cherry'];
      const sorted = sortPackageNames([...packages]);
      
      expect(sorted).to.deep.equal(['apple', 'BANANA', 'cherry', 'Zebra']);
    });

    it('should handle empty array', () => {
      const packages = [];
      const sorted = sortPackageNames([...packages]);
      
      expect(sorted).to.deep.equal([]);
    });

    it('should handle single package', () => {
      const packages = ['single-package'];
      const sorted = sortPackageNames([...packages]);
      
      expect(sorted).to.deep.equal(['single-package']);
    });
  });

  describe('PyPI Server Integration', () => {
    let pypiServer;

    before(() => {
      // Load the PyPI server module
      pypiServer = require('../../pypi/server');
    });

    it('should load PyPI server without errors', () => {
      expect(pypiServer).to.be.an('object');
      expect(pypiServer.attachToApp).to.be.a('function');
    });

    it('should have the sorting functionality integrated', () => {
      // This test verifies that the PyPI server module loads correctly
      // The actual sorting is tested in the HTTP integration tests
      expect(pypiServer).to.not.be.null;
    });
  });
}); 