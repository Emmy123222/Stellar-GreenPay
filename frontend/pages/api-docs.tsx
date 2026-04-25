/**
 * pages/api-docs.tsx — API documentation for GreenPay endpoints
 */
import { useState } from "react";
import axios from "axios";

interface ApiEndpoint {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  description: string;
  resource: string;
  example?: {
    request?: Record<string, any>;
    response?: Record<string, any>;
  };
}

const endpoints: ApiEndpoint[] = [
  {
    resource: "Projects",
    method: "GET",
    path: "/api/projects",
    description: "Fetch all projects with optional filtering",
    example: {
      response: {
        success: true,
        data: [{
          id: "123e4567-e89b-12d3-a456-426614174000",
          name: "Reforestation Initiative",
          description: "Planting trees across Asia",
          category: "Reforestation",
          raisedXLM: "5000.0000000",
          goalXLM: "10000.0000000",
          donorCount: 42,
        }],
      },
    },
  },
  {
    resource: "Projects",
    method: "GET",
    path: "/api/projects/:id",
    description: "Fetch a single project by ID",
    example: {
      response: {
        success: true,
        data: {
          id: "123e4567-e89b-12d3-a456-426614174000",
          name: "Reforestation Initiative",
          donorCount: 42,
          raisedXLM: "5000.0000000",
          goalXLM: "10000.0000000",
          campaigns: [],
          milestones: [],
        },
      },
    },
  },
  {
    resource: "Projects",
    method: "POST",
    path: "/api/projects/:id/matching",
    description: "Create a donation matching offer",
    example: {
      request: {
        matcherAddress: "GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2EURIDVXL6B",
        capXLM: "1000",
        multiplier: 2,
        expiresAt: "2026-05-25T00:00:00Z",
      },
      response: {
        success: true,
        data: {
          id: "match-id-123",
          projectId: "project-id",
          matcherAddress: "GBUQWP...",
          capXLM: "1000",
          multiplier: 2,
          matchedXLM: "0",
          expiresAt: "2026-05-25T00:00:00Z",
        },
      },
    },
  },
  {
    resource: "Projects",
    method: "GET",
    path: "/api/projects/:id/matching",
    description: "Fetch active matching offers for a project",
    example: {
      response: {
        success: true,
        data: [{
          id: "match-id-123",
          projectId: "project-id",
          matcherAddress: "GBUQWP...",
          capXLM: "1000",
          multiplier: 2,
          matchedXLM: "250.5",
          remainingXLM: "749.5",
          expiresAt: "2026-05-25T00:00:00Z",
        }],
      },
    },
  },
  {
    resource: "Donations",
    method: "POST",
    path: "/api/donations",
    description: "Record a donation after blockchain confirmation",
    example: {
      request: {
        projectId: "123e4567-e89b-12d3-a456-426614174000",
        donorAddress: "GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2EURIDVXL6B",
        amountXLM: "100",
        transactionHash: "abc123def456",
        message: "Great project!",
      },
      response: {
        success: true,
        data: {
          id: "donation-id",
          projectId: "project-id",
          donorAddress: "GBUQWP...",
          amountXLM: "100.0000000",
          transactionHash: "abc123def456",
          createdAt: "2026-04-25T12:00:00Z",
        },
      },
    },
  },
  {
    resource: "Donations",
    method: "GET",
    path: "/api/donations/project/:id/messages",
    description: "Fetch donation messages for a project",
    example: {
      response: {
        success: true,
        data: [{
          id: "donation-id",
          message: "Great project!",
          donorAddress: "GBUQWP...",
          amountXLM: "100.0000000",
          createdAt: "2026-04-25T12:00:00Z",
        }],
      },
    },
  },
  {
    resource: "Leaderboard",
    method: "GET",
    path: "/api/leaderboard",
    description: "Fetch top donors by XLM donated (supports period filtering)",
    example: {
      response: {
        success: true,
        data: [{
          rank: 1,
          publicKey: "GBUQWP...",
          displayName: "Climate Champion",
          totalDonatedXLM: "5000.0000000",
          projectsSupported: 12,
          topBadge: "🌍",
        }],
      },
    },
  },
  {
    resource: "Profiles",
    method: "GET",
    path: "/api/profiles/:publicKey",
    description: "Fetch a donor profile",
    example: {
      response: {
        success: true,
        data: {
          publicKey: "GBUQWP...",
          displayName: "Climate Champion",
          totalDonatedXLM: "5000.0000000",
          projectsSupported: 12,
          badges: [{tier: "🌍"}],
        },
      },
    },
  },
  {
    resource: "Profiles",
    method: "POST",
    path: "/api/profiles",
    description: "Create or update a donor profile",
    example: {
      request: {
        publicKey: "GBUQWP...",
        displayName: "My Name",
        bio: "Climate advocate",
      },
      response: {
        success: true,
        data: {
          publicKey: "GBUQWP...",
          displayName: "My Name",
          totalDonatedXLM: "0",
          projectsSupported: 0,
        },
      },
    },
  },
];

function EndpointCard({ endpoint }: { endpoint: ApiEndpoint }) {
  const [showResponse, setShowResponse] = useState(false);
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const methodColors: Record<string, string> = {
    GET: "bg-blue-100 text-blue-700",
    POST: "bg-green-100 text-green-700",
    PUT: "bg-yellow-100 text-yellow-700",
    DELETE: "bg-red-100 text-red-700",
  };

  const tryEndpoint = async () => {
    setLoading(true);
    setError(null);
    try {
      const api = axios.create({
        baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000",
      });

      const path = endpoint.path.replace(":id", "featured").replace(":projectId", "1");
      const res = await api[endpoint.method.toLowerCase() as keyof typeof api](
        path,
        endpoint.example?.request,
      );
      setResponse(res.data);
    } catch (err: any) {
      setError(err.message || "Failed to fetch");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card border-l-4 border-forest-600">
      <div className="flex items-start gap-4 mb-4">
        <span className={`px-3 py-1 rounded font-bold text-sm ${methodColors[endpoint.method]}`}>
          {endpoint.method}
        </span>
        <div className="flex-1">
          <p className="font-mono text-sm font-semibold text-forest-900">{endpoint.path}</p>
          <p className="text-sm text-[#5a7a5a] mt-1">{endpoint.description}</p>
        </div>
      </div>

      {endpoint.example && (
        <div className="space-y-3">
          {endpoint.example.request && (
            <div className="bg-forest-50 p-3 rounded border border-forest-200">
              <p className="text-xs font-semibold text-forest-900 mb-2">Request Body:</p>
              <pre className="text-xs overflow-auto text-forest-700">
                {JSON.stringify(endpoint.example.request, null, 2)}
              </pre>
            </div>
          )}

          {endpoint.example.response && (
            <div className="bg-forest-50 p-3 rounded border border-forest-200">
              <p className="text-xs font-semibold text-forest-900 mb-2">Example Response:</p>
              <pre className="text-xs overflow-auto text-forest-700">
                {JSON.stringify(endpoint.example.response, null, 2)}
              </pre>
            </div>
          )}

          <button
            onClick={() => {
              if (!showResponse) {
                tryEndpoint();
              }
              setShowResponse(!showResponse);
            }}
            className="text-xs text-forest-600 hover:text-forest-700 font-semibold"
          >
            {showResponse ? "Hide" : "Try it out"}
          </button>

          {showResponse && (
            <div className="bg-blue-50 p-3 rounded border border-blue-200">
              {loading && <p className="text-sm text-blue-700">Loading...</p>}
              {error && <p className="text-sm text-red-700">Error: {error}</p>}
              {response && (
                <>
                  <p className="text-xs font-semibold text-blue-900 mb-2">Response:</p>
                  <pre className="text-xs overflow-auto text-blue-700">
                    {JSON.stringify(response, null, 2)}
                  </pre>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ApiDocsPage() {
  const resources = ["Projects", "Donations", "Leaderboard", "Profiles"];

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 animate-fade-in">
      <div className="mb-10">
        <h1 className="font-display text-4xl font-bold text-forest-900 mb-3">
          API Documentation
        </h1>
        <p className="text-[#5a7a5a] max-w-2xl font-body leading-relaxed">
          Integrate GreenPay into your application with our REST API. All responses return JSON with a <code className="bg-forest-50 px-2 py-1 rounded text-sm">success</code> field.
        </p>
      </div>

      {/* Base URL */}
      <div className="card mb-8 border-l-4 border-purple-600">
        <p className="text-xs uppercase tracking-widest font-bold text-purple-700 mb-2">Base URL</p>
        <code className="font-mono bg-purple-50 px-4 py-2 rounded block text-sm text-purple-900 overflow-auto">
          {process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"}
        </code>
      </div>

      {/* Resources */}
      <div className="space-y-8">
        {resources.map((resource) => (
          <div key={resource}>
            <h2 className="font-display text-2xl font-bold text-forest-900 mb-4">
              {resource}
            </h2>
            <div className="space-y-4">
              {endpoints
                .filter((e) => e.resource === resource)
                .map((endpoint, i) => (
                  <EndpointCard key={i} endpoint={endpoint} />
                ))}
            </div>
          </div>
        ))}
      </div>

      {/* JavaScript Example */}
      <div className="mt-12 pt-8 border-t border-forest-200">
        <h2 className="font-display text-2xl font-bold text-forest-900 mb-4">
          JavaScript Example
        </h2>
        <div className="bg-forest-50 p-4 rounded border border-forest-200 overflow-auto">
          <pre className="text-sm text-forest-700 font-mono">{`// Fetch all projects
const response = await fetch('http://localhost:4000/api/projects');
const { success, data } = await response.json();

if (success) {
  console.log('Projects:', data);
}

// Record a donation
const donationRes = await fetch('http://localhost:4000/api/donations', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    projectId: 'project-id',
    donorAddress: 'GBUQWP...',
    amountXLM: '100',
    transactionHash: 'abc123...',
  }),
});

const donation = await donationRes.json();
console.log('Donation recorded:', donation.data);`}</pre>
        </div>
      </div>
    </div>
  );
}
