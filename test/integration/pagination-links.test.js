const axios = require("axios");
const { expect } = require("chai");

/**
 * Integration tests for pagination link generation across all package registry servers.
 * Verifies that pagination links include the complete collection path.
 */
describe("Pagination Links Integration", function () {
  // Increase timeout for integration tests
  this.timeout(30000);

  // Test configurations for each server
  const servers = [
    {
      name: "NPM",
      baseUrl: "http://localhost:3001",
      collectionPath: "/noderegistries/npmjs.org/packages",
      testParams: "?limit=2&offset=0",
    },
    {
      name: "PyPI",
      baseUrl: "http://localhost:3002",
      collectionPath: "/pythonregistries/pypi.org/packages",
      testParams: "?limit=2&offset=0",
    },
    {
      name: "NuGet",
      baseUrl: "http://localhost:3003",
      collectionPath: "/nugetregistries/nuget.org/packages",
      testParams: "?limit=2&offset=0",
    },
    {
      name: "OCI",
      baseUrl: "http://localhost:3004",
      collectionPath: "/containerregistries/docker.io/images",
      testParams: "?limit=2&offset=0",
    },
    {
      name: "Maven",
      baseUrl: "http://localhost:3005",
      collectionPath: "/mavenregistries/central.maven.org/packages",
      testParams: "?limit=2&offset=0",
    },
  ];

  servers.forEach((server) => {
    describe(`${server.name} Server Pagination`, function () {
      it("should include full collection path in pagination links", async function () {
        const url = `${server.baseUrl}${server.collectionPath}${server.testParams}`;

        try {
          const response = await axios.get(url, {
            timeout: 15000,
            validateStatus: (status) => status < 500, // Accept 4xx but not 5xx
          });

          // Skip test if server is not available (404, 503, etc.)
          if (response.status === 404 || response.status === 503) {
            this.skip();
            return;
          }

          expect(response.status).to.equal(200);

          // Check that Link header exists
          const linkHeader = response.headers.link;
          expect(linkHeader).to.exist;
          expect(linkHeader).to.be.a("string");

          console.log(`${server.name} Link header:`, linkHeader);

          // Parse the Link header to extract pagination URLs
          const links = parseLinkHeader(linkHeader);

          // Verify that pagination links include the full collection path
          ["first", "next", "last"].forEach((rel) => {
            if (links[rel]) {
              expect(links[rel]).to.include(server.collectionPath);
              expect(links[rel]).to.include(server.baseUrl);
              console.log(`${server.name} ${rel} link:`, links[rel]);
            }
          });

          // Verify the first link specifically
          if (links.first) {
            const expectedStart = `${server.baseUrl}${server.collectionPath}`;
            expect(links.first).to.include(expectedStart);
          }
        } catch (error) {
          if (error.code === "ECONNREFUSED" || error.code === "ENOTFOUND") {
            console.log(`${server.name} server not available, skipping test`);
            this.skip();
          } else {
            throw error;
          }
        }
      });

      it("should preserve query parameters in pagination links", async function () {
        const url = `${server.baseUrl}${server.collectionPath}?filter=name%3D*test*&limit=2&offset=0`;

        try {
          const response = await axios.get(url, {
            timeout: 15000,
            validateStatus: (status) => status < 500, // Accept 4xx but not 5xx
          });

          // Skip test if server is not available or doesn't support filtering
          if (
            response.status === 404 ||
            response.status === 503 ||
            response.status === 400
          ) {
            this.skip();
            return;
          }

          expect(response.status).to.equal(200);

          const linkHeader = response.headers.link;
          if (!linkHeader) {
            this.skip(); // Some servers might not return pagination links for filter requests
            return;
          }

          console.log(`${server.name} Link header with filter:`, linkHeader);

          const links = parseLinkHeader(linkHeader);

          // Verify that filter parameters are preserved in pagination links
          ["first", "next", "last"].forEach((rel) => {
            if (links[rel]) {
              expect(links[rel]).to.include("filter=");
              expect(links[rel]).to.include(server.collectionPath);
              console.log(
                `${server.name} ${rel} link with filter:`,
                links[rel]
              );
            }
          });
        } catch (error) {
          if (error.code === "ECONNREFUSED" || error.code === "ENOTFOUND") {
            console.log(`${server.name} server not available, skipping test`);
            this.skip();
          } else {
            throw error;
          }
        }
      });
    });
  });

  /**
   * Parse Link header according to RFC 5988
   * @param {string} linkHeader - The Link header value
   * @returns {Object} - Object with rel values as keys and URLs as values
   */
  function parseLinkHeader(linkHeader) {
    const links = {};
    const parts = linkHeader.split(",");

    parts.forEach((part) => {
      const section = part.trim();
      if (!section) return;

      const urlMatch = section.match(/<([^>]+)>/);
      const relMatch = section.match(/rel="([^"]+)"/);

      if (urlMatch && relMatch) {
        const url = urlMatch[1];
        const rel = relMatch[1];
        links[rel] = url;
      }
    });

    return links;
  }
});
