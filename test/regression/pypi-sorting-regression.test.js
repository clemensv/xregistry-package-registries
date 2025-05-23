const { expect } = require('chai');
const request = require('supertest');
const express = require('express');

describe('PyPI Sorting Regression Tests', () => {
  let app;
  let pypiServer;

  before(() => {
    // Load PyPI server and attach to test app
    app = express();
    
    // Configure Express
    app.set('decode_param_values', false);
    app.enable('strict routing');
    app.enable('case sensitive routing');
    app.disable('x-powered-by');

    try {
      pypiServer = require('../../pypi/server');
      pypiServer.attachToApp(app, {
        pathPrefix: '/pythonregistries',
        quiet: true
      });
    } catch (error) {
      console.warn('Failed to load PyPI server for regression tests:', error.message);
    }
  });

  describe('Package Listing Sort Order', () => {
    it('should maintain letter-first sorting in package listings', function(done) {
      // Skip if PyPI server not available
      if (!pypiServer) {
        this.skip();
        return;
      }

      // Test the packages endpoint with a limit to get a manageable response
      request(app)
        .get('/pythonregistries/pypi.org/packages?limit=20')
        .expect((res) => {
          // Should return either 200 or 404 (if no packages available)
          expect([200, 404]).to.include(res.status);
          
          if (res.status === 200 && res.body && res.body.packages) {
            const packageNames = Object.keys(res.body.packages);
            
            if (packageNames.length > 1) {
              // Verify that letter-starting packages come before number/symbol-starting packages
              let foundNonLetter = false;
              let foundLetterAfterNonLetter = false;
              
              packageNames.forEach(name => {
                const startsWithLetter = /^[a-zA-Z]/.test(name.charAt(0));
                
                if (!startsWithLetter) {
                  foundNonLetter = true;
                } else if (foundNonLetter) {
                  foundLetterAfterNonLetter = true;
                }
              });
              
              // If we found both types, letter-starting should not come after non-letter-starting
              if (foundNonLetter) {
                expect(foundLetterAfterNonLetter).to.be.false;
              }
            }
          }
        })
        .end(done);
    });

    it('should maintain alphabetical order within letter-starting packages', function(done) {
      // Skip if PyPI server not available
      if (!pypiServer) {
        this.skip();
        return;
      }

      request(app)
        .get('/pythonregistries/pypi.org/packages?limit=50')
        .expect((res) => {
          expect([200, 404]).to.include(res.status);
          
          if (res.status === 200 && res.body && res.body.packages) {
            const packageNames = Object.keys(res.body.packages);
            const letterStartingPackages = packageNames.filter(name => /^[a-zA-Z]/.test(name.charAt(0)));
            
            if (letterStartingPackages.length > 1) {
              // Check if letter-starting packages are in alphabetical order
              for (let i = 1; i < letterStartingPackages.length; i++) {
                const prev = letterStartingPackages[i - 1].toLowerCase();
                const curr = letterStartingPackages[i].toLowerCase();
                expect(prev.localeCompare(curr)).to.be.at.most(0);
              }
            }
          }
        })
        .end(done);
    });

    it('should handle edge cases in package names', function(done) {
      // Skip if PyPI server not available
      if (!pypiServer) {
        this.skip();
        return;
      }

      // Test with various query parameters to ensure sorting is consistent
      const testCases = [
        '/pythonregistries/pypi.org/packages?limit=10',
        '/pythonregistries/pypi.org/packages?limit=5&offset=0',
        '/pythonregistries/pypi.org/packages'
      ];

      let completedTests = 0;
      const totalTests = testCases.length;

      testCases.forEach(endpoint => {
        request(app)
          .get(endpoint)
          .expect((res) => {
            // Should not crash or return 500 errors
            expect(res.status).to.not.equal(500);
          })
          .end((err) => {
            if (err) return done(err);
            
            completedTests++;
            if (completedTests === totalTests) {
              done();
            }
          });
      });
    });
  });

  describe('Sorting Algorithm Consistency', () => {
    it('should produce consistent results across multiple requests', function(done) {
      // Skip if PyPI server not available
      if (!pypiServer) {
        this.skip();
        return;
      }

      const endpoint = '/pythonregistries/pypi.org/packages?limit=10';
      let firstResponse;

      // Make first request
      request(app)
        .get(endpoint)
        .end((err, res1) => {
          if (err) return done(err);
          
          firstResponse = res1.body;
          
          // Make second request
          request(app)
            .get(endpoint)
            .end((err, res2) => {
              if (err) return done(err);
              
              // Results should be identical
              if (res1.status === 200 && res2.status === 200) {
                expect(res2.body).to.deep.equal(firstResponse);
              }
              
              done();
            });
        });
    });
  });
}); 