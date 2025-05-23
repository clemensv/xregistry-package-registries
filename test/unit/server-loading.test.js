const { expect } = require('chai');
const path = require('path');

describe('Server Module Loading', () => {
  const servers = [
    { name: 'PyPI', path: '../../pypi/server', expectedExports: ['attachToApp'] },
    { name: 'NPM', path: '../../npm/server', expectedExports: ['attachToApp'] },
    { name: 'Maven', path: '../../maven/server', expectedExports: ['attachToApp'] },
    { name: 'NuGet', path: '../../nuget/server', expectedExports: ['attachToApp'] },
    { name: 'OCI', path: '../../oci/server', expectedExports: ['attachToApp'] }
  ];

  servers.forEach(serverConfig => {
    describe(`${serverConfig.name} Server`, () => {
      let serverModule;

      it('should load without errors', () => {
        expect(() => {
          serverModule = require(serverConfig.path);
        }).to.not.throw();
      });

      it('should export required functions', () => {
        expect(serverModule).to.be.an('object');
        
        serverConfig.expectedExports.forEach(exportName => {
          expect(serverModule).to.have.property(exportName);
          expect(serverModule[exportName]).to.be.a('function');
        });
      });

      it('should have attachToApp function that accepts parameters', () => {
        const attachToApp = serverModule.attachToApp;
        expect(attachToApp).to.be.a('function');
        expect(attachToApp.length).to.be.at.least(1); // Should accept at least app parameter
      });
    });
  });
}); 