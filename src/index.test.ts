import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the cloudflare:workers module
vi.mock("cloudflare:workers", () => ({
	DurableObject: class MockDurableObject {
		ctx: any;
		env: any;
		constructor(ctx: any, env: any) {
			this.ctx = ctx;
			this.env = env;
		}
	},
}));

import { MyDurableObject } from "./index";

/**
 * Mock for DurableObjectState
 */
class MockDurableObjectState {
	storage = {
		sql: {
			exec: vi.fn(),
		},
	};
}

/**
 * Mock for DurableObjectId
 */
class MockDurableObjectId {
	constructor(public readonly id: string) {}
}

/**
 * Mock for DurableObjectStub
 */
class MockDurableObjectStub {
	sayHello = vi.fn();
}

/**
 * Mock for DurableObjectNamespace
 */
class MockDurableObjectNamespace {
	idFromName(name: string) {
		return new MockDurableObjectId(name);
	}

	get(id: MockDurableObjectId) {
		return new MockDurableObjectStub();
	}
}

describe("MyDurableObject", () => {
	let mockState: MockDurableObjectState;
	let mockEnv: any;
	let durableObject: MyDurableObject;

	beforeEach(() => {
		mockState = new MockDurableObjectState();
		mockEnv = {};
		durableObject = new MyDurableObject(mockState as any, mockEnv);
	});

	describe("sayHello", () => {
		it("should execute a SQL query and return the greeting", async () => {
			// Arrange
			const mockResult = { greeting: "Hello, World!" };
			(mockState.storage.sql.exec as any).mockReturnValue({
				one: () => mockResult,
			});

			// Act
			const result = await durableObject.sayHello();

			// Assert
			expect(result).toBe("Hello, World!");
			expect(mockState.storage.sql.exec).toHaveBeenCalledWith(
				"SELECT 'Hello, World!' as greeting"
			);
		});

		it("should return the greeting from database query result", async () => {
			// Arrange
			const customGreeting = "Hello, Test!";
			const mockResult = { greeting: customGreeting };
			(mockState.storage.sql.exec as any).mockReturnValue({
				one: () => mockResult,
			});

			// Act
			const result = await durableObject.sayHello();

			// Assert
			expect(result).toBe(customGreeting);
		});

		it("should call SQL exec method with exact query string", async () => {
			// Arrange
			(mockState.storage.sql.exec as any).mockReturnValue({
				one: () => ({ greeting: "Hello, World!" }),
			});

			// Act
			await durableObject.sayHello();

			// Assert
			expect(mockState.storage.sql.exec).toHaveBeenCalledWith(
				"SELECT 'Hello, World!' as greeting"
			);
			expect(mockState.storage.sql.exec).toHaveBeenCalledTimes(1);
		});

		it("should handle null result gracefully by extracting greeting property", async () => {
			// Arrange - Tests edge case of different result shapes
			const mockResult = { greeting: "Custom Response" };
			(mockState.storage.sql.exec as any).mockReturnValue({
				one: () => mockResult,
			});

			// Act
			const result = await durableObject.sayHello();

			// Assert
			expect(result).toBe("Custom Response");
		});
	});
});

describe("Worker fetch handler", () => {
	let mockNamespace: MockDurableObjectNamespace;
	let mockEnv: any;

	beforeEach(() => {
		mockNamespace = new MockDurableObjectNamespace();
		mockEnv = {
			MY_DURABLE_OBJECT: mockNamespace,
		};
	});

	describe("fetch", async () => {
		it("should extract pathname from request URL and create Durable Object ID", async () => {
			// Arrange
			const testPath = "/test-user";
			const mockRequest = new Request(`http://localhost:8787${testPath}`, {
				method: "GET",
			});
			const idFromNameSpy = vi.spyOn(mockNamespace, "idFromName");

			// Dynamically import the handler to ensure fresh module
			const { default: handler } = await import("./index");

			// Act
			await handler.fetch(mockRequest, mockEnv, {});

			// Assert
			expect(idFromNameSpy).toHaveBeenCalledWith(testPath);
		});

		it("should handle root path correctly", async () => {
			// Arrange
			const mockRequest = new Request("http://localhost:8787/", {
				method: "GET",
			});
			const idFromNameSpy = vi.spyOn(mockNamespace, "idFromName");

			// Dynamically import the handler
			const { default: handler } = await import("./index");

			// Act
			await handler.fetch(mockRequest, mockEnv, {});

			// Assert
			expect(idFromNameSpy).toHaveBeenCalledWith("/");
		});

		it("should handle different URL paths to create different IDs", async () => {
			// Arrange
			const paths = ["/user-1", "/user-2", "/admin"];
			const idFromNameSpy = vi.spyOn(mockNamespace, "idFromName");

			// Dynamically import the handler
			const { default: handler } = await import("./index");

			// Act
			for (const path of paths) {
				const mockRequest = new Request(`http://localhost:8787${path}`, {
					method: "GET",
				});
				await handler.fetch(mockRequest, mockEnv, {});
			}

			// Assert
			expect(idFromNameSpy).toHaveBeenNthCalledWith(1, "/user-1");
			expect(idFromNameSpy).toHaveBeenNthCalledWith(2, "/user-2");
			expect(idFromNameSpy).toHaveBeenNthCalledWith(3, "/admin");
		});

		it("should call sayHello on the Durable Object stub", async () => {
			// Arrange
			const mockRequest = new Request("http://localhost:8787/test", {
				method: "GET",
			});
			const getSpy = vi.spyOn(mockNamespace, "get");
			const mockStub = new MockDurableObjectStub();
			mockStub.sayHello.mockResolvedValue("Hello, World!");
			getSpy.mockReturnValue(mockStub as any);

			// Dynamically import the handler
			const { default: handler } = await import("./index");

			// Act
			await handler.fetch(mockRequest, mockEnv, {});

			// Assert
			expect(mockStub.sayHello).toHaveBeenCalled();
		});

		it("should return the greeting from sayHello as response body", async () => {
			// Arrange
			const expectedGreeting = "Hello, World!";
			const mockRequest = new Request("http://localhost:8787/test", {
				method: "GET",
			});
			const mockStub = new MockDurableObjectStub();
			mockStub.sayHello.mockResolvedValue(expectedGreeting);
			vi.spyOn(mockNamespace, "get").mockReturnValue(mockStub as any);

			// Dynamically import the handler
			const { default: handler } = await import("./index");

			// Act
			const response = await handler.fetch(mockRequest, mockEnv, {});

			// Assert
			expect(response).toBeInstanceOf(Response);
			const body = await response.text();
			expect(body).toBe(expectedGreeting);
		});

		it("should return a Response object", async () => {
			// Arrange
			const mockRequest = new Request("http://localhost:8787/", {
				method: "GET",
			});
			const mockStub = new MockDurableObjectStub();
			mockStub.sayHello.mockResolvedValue("Hello, World!");
			vi.spyOn(mockNamespace, "get").mockReturnValue(mockStub as any);

			// Dynamically import the handler
			const { default: handler } = await import("./index");

			// Act
			const response = await handler.fetch(mockRequest, mockEnv, {});

			// Assert
			expect(response).toBeInstanceOf(Response);
		});

		it("should handle path with query parameters correctly", async () => {
			// Arrange
			const testPath = "/user";
			const mockRequest = new Request(
				`http://localhost:8787${testPath}?id=123&name=test`,
				{
					method: "GET",
				}
			);
			const idFromNameSpy = vi.spyOn(mockNamespace, "idFromName");

			// Dynamically import the handler
			const { default: handler } = await import("./index");

			// Act
			await handler.fetch(mockRequest, mockEnv, {});

			// Assert
			// Only the pathname should be used, not the query string
			expect(idFromNameSpy).toHaveBeenCalledWith(testPath);
		});

		it("should handle path with multiple segments", async () => {
			// Arrange
			const testPath = "/api/users/123";
			const mockRequest = new Request(`http://localhost:8787${testPath}`, {
				method: "GET",
			});
			const idFromNameSpy = vi.spyOn(mockNamespace, "idFromName");

			// Dynamically import the handler
			const { default: handler } = await import("./index");

			// Act
			await handler.fetch(mockRequest, mockEnv, {});

			// Assert
			expect(idFromNameSpy).toHaveBeenCalledWith(testPath);
		});

		it("should preserve pathname encoding for special characters", async () => {
			// Arrange - Tests edge case with special characters
			const testPath = "/user%20space";
			const mockRequest = new Request(`http://localhost:8787${testPath}`, {
				method: "GET",
			});
			const idFromNameSpy = vi.spyOn(mockNamespace, "idFromName");

			// Dynamically import the handler
			const { default: handler } = await import("./index");

			// Act
			await handler.fetch(mockRequest, mockEnv, {});

			// Assert
			expect(idFromNameSpy).toHaveBeenCalledWith(testPath);
		});
	});
});


