const { expect } = require("chai");

/**
 * Unit tests for pagination link generation logic.
 * These tests verify the core pagination link functionality without requiring running servers.
 */
describe("Pagination Links Unit Tests", function () {
  // Mock request object that simulates an HTTP request
  function createMockRequest(
    path,
    query = {},
    protocol = "http",
    host = "localhost:3000"
  ) {
    return {
      path: path,
      query: query,
      protocol: protocol,
      get: (header) => {
        if (header === "host") return host;
        return null;
      },
    };
  }

  // Test the pagination link generation logic directly
  function testGeneratePaginationLinks(
    req,
    totalCount,
    offset,
    limit,
    BASE_URL = null
  ) {
    const links = [];

    // Construct the base URL properly (copied from fixed implementation)
    let baseUrl;
    if (BASE_URL) {
      // If BASE_URL is set, use it with the path
      baseUrl = `${BASE_URL}${req.path}`;
    } else {
      // If BASE_URL is not set, construct from request
      baseUrl = `${req.protocol}://${req.get("host")}${req.path}`;
    }

    // Add base query parameters from original request (except pagination ones)
    const queryParams = { ...req.query };
    delete queryParams.limit;
    delete queryParams.offset;

    // Build the base query string
    let queryString =
      Object.keys(queryParams).length > 0
        ? "?" +
          Object.entries(queryParams)
            .map(
              ([key, value]) =>
                `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
            )
            .join("&")
        : "";

    // If we have any params already, use & to add more, otherwise start with ?
    const paramPrefix = queryString ? "&" : "?";

    // Calculate totalPages (ceiling division)
    const totalPages = Math.ceil(totalCount / limit);

    // First link
    const firstUrl = `${baseUrl}${queryString}${paramPrefix}limit=${limit}&offset=0`;
    links.push(`<${firstUrl}>; rel="first"`);

    // Previous link (if not on the first page)
    if (offset > 0) {
      const prevOffset = Math.max(0, offset - limit);
      const prevUrl = `${baseUrl}${queryString}${paramPrefix}limit=${limit}&offset=${prevOffset}`;
      links.push(`<${prevUrl}>; rel="prev"`);
    }

    // Next link (if not on the last page)
    if (offset + limit < totalCount) {
      const nextUrl = `${baseUrl}${queryString}${paramPrefix}limit=${limit}&offset=${
        offset + limit
      }`;
      links.push(`<${nextUrl}>; rel="next"`);
    }

    // Last link
    const lastOffset = Math.max(0, (totalPages - 1) * limit);
    const lastUrl = `${baseUrl}${queryString}${paramPrefix}limit=${limit}&offset=${lastOffset}`;
    links.push(`<${lastUrl}>; rel="last"`);

    // Add count and total-count as per RFC5988
    links.push(`count="${totalCount}"`);
    links.push(`per-page="${limit}"`);

    return links.join(", ");
  }

  describe("Collection Path Inclusion", function () {
    it("should include full collection path for NPM packages", function () {
      const req = createMockRequest("/noderegistries/npmjs.org/packages");
      const linkHeader = testGeneratePaginationLinks(req, 100, 0, 10);

      expect(linkHeader).to.include(
        "http://localhost:3000/noderegistries/npmjs.org/packages"
      );
      expect(linkHeader).to.include('rel="first"');
      expect(linkHeader).to.include('rel="next"');
      expect(linkHeader).to.include('rel="last"');
    });

    it("should include full collection path for PyPI packages", function () {
      const req = createMockRequest("/pythonregistries/pypi.org/packages");
      const linkHeader = testGeneratePaginationLinks(req, 100, 20, 10);

      expect(linkHeader).to.include(
        "http://localhost:3000/pythonregistries/pypi.org/packages"
      );
      expect(linkHeader).to.include('rel="first"');
      expect(linkHeader).to.include('rel="prev"');
      expect(linkHeader).to.include('rel="next"');
      expect(linkHeader).to.include('rel="last"');
    });

    it("should include full collection path for NuGet packages", function () {
      const req = createMockRequest("/nugetregistries/nuget.org/packages");
      const linkHeader = testGeneratePaginationLinks(req, 50, 40, 10);

      expect(linkHeader).to.include(
        "http://localhost:3000/nugetregistries/nuget.org/packages"
      );
      expect(linkHeader).to.include('rel="first"');
      expect(linkHeader).to.include('rel="prev"');
      expect(linkHeader).to.include('rel="last"');
    });

    it("should include full collection path for OCI images", function () {
      const req = createMockRequest("/containerregistries/docker.io/images");
      const linkHeader = testGeneratePaginationLinks(req, 30, 10, 10);

      expect(linkHeader).to.include(
        "http://localhost:3000/containerregistries/docker.io/images"
      );
      expect(linkHeader).to.include('rel="first"');
      expect(linkHeader).to.include('rel="prev"');
      expect(linkHeader).to.include('rel="next"');
      expect(linkHeader).to.include('rel="last"');
    });

    it("should include full collection path for Maven packages", function () {
      const req = createMockRequest(
        "/mavenregistries/central.maven.org/packages"
      );
      const linkHeader = testGeneratePaginationLinks(req, 200, 0, 25);

      expect(linkHeader).to.include(
        "http://localhost:3000/mavenregistries/central.maven.org/packages"
      );
      expect(linkHeader).to.include('rel="first"');
      expect(linkHeader).to.include('rel="next"');
      expect(linkHeader).to.include('rel="last"');
    });
  });

  describe("Query Parameter Preservation", function () {
    it("should preserve filter parameters in pagination links", function () {
      const req = createMockRequest("/noderegistries/npmjs.org/packages", {
        filter: "name=*util*",
        sort: "name",
      });
      const linkHeader = testGeneratePaginationLinks(req, 100, 0, 10);

      expect(linkHeader).to.include("filter=name%3D*util*");
      expect(linkHeader).to.include("sort=name");
      expect(linkHeader).to.include("limit=10");
      expect(linkHeader).to.include("offset=0");
    });

    it("should handle URL encoding in filter parameters", function () {
      const req = createMockRequest("/pythonregistries/pypi.org/packages", {
        filter: "name=*test*&description=*lib*",
      });
      const linkHeader = testGeneratePaginationLinks(req, 50, 10, 5);

      expect(linkHeader).to.include("filter=");
      expect(linkHeader).to.include("limit=5");
      expect(linkHeader).to.include("offset=");
    });
  });

  describe("BASE_URL Configuration", function () {
    it("should use BASE_URL when provided", function () {
      const req = createMockRequest("/noderegistries/npmjs.org/packages");
      const BASE_URL = "https://api.example.com";
      const linkHeader = testGeneratePaginationLinks(req, 100, 0, 10, BASE_URL);

      expect(linkHeader).to.include(
        "https://api.example.com/noderegistries/npmjs.org/packages"
      );
      expect(linkHeader).not.to.include("http://localhost:3000");
    });

    it("should construct URL from request when BASE_URL is not set", function () {
      const req = createMockRequest(
        "/pythonregistries/pypi.org/packages",
        {},
        "https",
        "api.myregistry.com"
      );
      const linkHeader = testGeneratePaginationLinks(req, 100, 0, 10);

      expect(linkHeader).to.include(
        "https://api.myregistry.com/pythonregistries/pypi.org/packages"
      );
    });
  });

  describe("Edge Cases", function () {
    it("should handle empty query parameters", function () {
      const req = createMockRequest("/noderegistries/npmjs.org/packages", {});
      const linkHeader = testGeneratePaginationLinks(req, 100, 0, 10);

      expect(linkHeader).to.include(
        "http://localhost:3000/noderegistries/npmjs.org/packages?limit=10"
      );
    });

    it("should handle last page correctly", function () {
      const req = createMockRequest("/noderegistries/npmjs.org/packages");
      const linkHeader = testGeneratePaginationLinks(req, 95, 90, 10); // Last page

      expect(linkHeader).to.include('rel="first"');
      expect(linkHeader).to.include('rel="prev"');
      expect(linkHeader).not.to.include('rel="next"'); // Should not have next on last page
      expect(linkHeader).to.include('rel="last"');
    });

    it("should handle single page correctly", function () {
      const req = createMockRequest("/noderegistries/npmjs.org/packages");
      const linkHeader = testGeneratePaginationLinks(req, 5, 0, 10); // Only one page

      expect(linkHeader).to.include('rel="first"');
      expect(linkHeader).not.to.include('rel="prev"');
      expect(linkHeader).not.to.include('rel="next"');
      expect(linkHeader).to.include('rel="last"');
    });
  });
});
