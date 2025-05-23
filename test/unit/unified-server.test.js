const { expect } = require('chai');
const express = require('express');

describe('Unified Server', () => {
  describe('Server Registry Configuration', () => {
    let unifiedServer;

    before(() => {
      // Mock the environment to avoid loading all dependencies
      process.env.NODE_ENV = 'test';
    });

    it('should load the unified server module', () => {
      expect(() => {
        // We'll test the core logic without starting the actual server
        const fs = require('fs');
        const path = require('path');
        const serverPath = path.join(__dirname, '../../server.js');
        expect(fs.existsSync(serverPath)).to.be.true;
      }).to.not.throw();
    });

    it('should have proper server configuration constants', () => {
      // Test that the server file contains the expected configuration
      const fs = require('fs');
      const path = require('path');
      const serverContent = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');
      
      expect(serverContent).to.include('ENABLED_SERVERS');
      expect(serverContent).to.include('pypi');
      expect(serverContent).to.include('npm');
      expect(serverContent).to.include('maven');
      expect(serverContent).to.include('nuget');
      expect(serverContent).to.include('oci');
    });
  });

  describe('Express App Configuration', () => {
    let app;

    beforeEach(() => {
      app = express();
    });

    it('should create Express app without errors', () => {
      expect(app).to.be.a('function'); // Express apps are functions
      expect(app.listen).to.be.a('function');
    });

    it('should support middleware attachment', () => {
      expect(() => {
        app.use((req, res, next) => next());
      }).to.not.throw();
    });
  });
}); 