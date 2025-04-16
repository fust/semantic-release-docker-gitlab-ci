const publish = require('../publish');
const got = require('got');
const semver = require('semver');
const login = require('../auth');
const SemanticReleaseError = require('@semantic-release/error');

// Mock the external dependencies
jest.mock('got');
jest.mock('semver');
jest.mock('../auth');
jest.mock('@semantic-release/error');

describe('publish module', () => {
  // Setup common test variables
  const mockPluginConfig = { semver: false };
  const mockContext = {
    env: {
      CI_REGISTRY: 'registry.example.com',
      CI_PROJECT_PATH: 'group/project',
      CI_REGISTRY_USER: 'user',
      CI_REGISTRY_PASSWORD: 'password'
    },
    envCi: {
      commit: 'abc123'
    },
    nextRelease: {
      version: '1.2.3'
    }
  };
  
  const mockAuth = 'Bearer token123';
  const mockManifest = { schemaVersion: 2, layers: [] };
  
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Setup mock implementations
    login.mockResolvedValue(mockAuth);
    semver.major.mockReturnValue(1);
    semver.minor.mockReturnValue(2);
    semver.patch.mockReturnValue(3);
    semver.prerelease.mockReturnValue(null);
    
    // Mock got for manifest retrieval and pushing tags
    got.mockImplementation((url, options) => {
      if (options.method === 'GET') {
        return {
          json: jest.fn().mockResolvedValue(mockManifest)
        };
      }
      return { 
        // For PUT requests
        body: 'OK' 
      };
    });
  });

  test('should retrieve manifest and push tags', async () => {
    // Add a small delay to allow all async operations to complete
    await publish(mockPluginConfig, mockContext);
    
    // Wait for all microtasks to complete
    await new Promise(resolve => setTimeout(resolve, 0));
    
    // Verify login was called with correct parameters
    expect(login).toHaveBeenCalledWith(
      mockContext.env.CI_REGISTRY,
      mockContext.env.CI_PROJECT_PATH,
      mockContext.envCi.commit,
      mockContext.env.CI_REGISTRY_USER,
      mockContext.env.CI_REGISTRY_PASSWORD
    );
    
    // Verify got was called for manifest retrieval
    expect(got).toHaveBeenCalledWith(
      `https://${mockContext.env.CI_REGISTRY}/v2/${mockContext.env.CI_PROJECT_PATH}/manifests/${mockContext.envCi.commit}`.replace('/manifests/', '/manifests//'),
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: mockAuth,
          'content-type': 'application/vnd.docker.distribution.manifest.v2+json'
        })
      })
    );
    
    // Get all calls to got
    const calls = got.mock.calls;
    
    // Verify at least 4 calls were made (1 for getting manifest + 3 for tags)
    expect(calls.length).toBeGreaterThanOrEqual(4);
    
    // Find the PUT calls for each tag
    const putCalls = calls.filter(call => call[1] && call[1].method === 'PUT');
    
    // Check that the expected tag URLs were used
    expect(putCalls.some(call => call[0].includes('/manifests//1.2.3'))).toBe(true);
    expect(putCalls.some(call => call[0].includes('/manifests//1.2'))).toBe(true);
    expect(putCalls.some(call => call[0].includes('/manifests//1'))).toBe(true);
  });

  test('should only push semver tag when semver config is true', async () => {
    await publish({ semver: true }, mockContext);
    
    // Wait for all microtasks to complete
    await new Promise(resolve => setTimeout(resolve, 0));
    
    // Get all calls to got
    const calls = got.mock.calls;
    
    // Find the PUT calls
    const putCalls = calls.filter(call => call[1] && call[1].method === 'PUT');
    
    // Should be exactly one PUT call for the full version
    expect(putCalls.length).toBe(1);
    expect(putCalls[0][0]).toMatch(/\/manifests\/\/1\.2\.3$/);
  });
});