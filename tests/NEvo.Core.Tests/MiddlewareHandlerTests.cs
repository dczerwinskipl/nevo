using System.Linq.Expressions;

namespace NEvo.Core.Tests;

public class MiddlewareHandlerTests
{
    private static Expression<Func<Func<string, CancellationToken, Task<string>>, Task<string>>> InvokeWithAnyParams => f => f.Invoke(It.IsAny<string>(), It.IsAny<CancellationToken>());
    private static Expression<Func<IMiddleware<string, string>, Task<string>>> ExecuteAsyncWithAnyParams => m => m.ExecuteAsync(It.IsAny<string>(), It.IsAny<CancellationToken>(), It.IsAny<Func<Task<string>>>());

    [Fact]
    public async Task MiddlewareHandler_CallsBaseFunction()
    {
        // Arrange
        var returnValue = "Base";
        var handler = new MiddlewareHandler<string, string, IMiddleware<string, string>>(Enumerable.Empty<IMiddleware<string, string>>());
        var baseFunctionMock = new Mock<Func<string, CancellationToken, Task<string>>>();
        baseFunctionMock.Setup(InvokeWithAnyParams).ReturnsAsync(returnValue);

        // Act
        var result = await handler.ExecuteAsync(baseFunctionMock.Object, "Input", CancellationToken.None);

        // Assert
        baseFunctionMock.Verify(InvokeWithAnyParams, Times.Once());
        result.Should().Be(returnValue);
    }


    [Fact]
    public async Task MiddlewareHandler_ExecutesMiddlewaresInCorrectOrderAsync()
    {
        // Arrange
        var middlewareMocks = new List<Mock<IMiddleware<string, string>>>();
        var executionOrder = new List<string>();

        foreach (var name in new[] { "First", "Second", "Third" })
        {
            var mock = new Mock<IMiddleware<string, string>>();
            mock.Setup(ExecuteAsyncWithAnyParams)
                .Returns<string, CancellationToken, Func<Task<string>>>(async (input, ct, next) =>
                {
                    executionOrder.Add($"pre-{name}");
                    var nextResult = await next();
                    executionOrder.Add($"post-{name}");
                    return $"{name}-{nextResult}";
                });
            middlewareMocks.Add(mock);
        }

        var handler = new MiddlewareHandler<string, string, IMiddleware<string, string>>(middlewareMocks.ConvertAll(m => m.Object));

        // Act
        var result = await handler.ExecuteAsync((input, ct) =>
        {
            executionOrder.Add("Base");
            return Task.FromResult("Base");
        }, "Input", CancellationToken.None);

        // Assert
        result.Should().Be("First-Second-Third-Base");
        executionOrder.Should().Equal(new[] { "pre-First", "pre-Second", "pre-Third", "Base", "post-Third", "post-Second", "post-First" });
    }

    [Fact]
    public async Task MiddlewareHandler_ExecutesOnlySelectedMiddlewares_WhenShouldApplyIsProvided()
    {
        // Arrange
        var firstMiddlewareMock = new Mock<IMiddleware<string, string>>();
        var secondMiddlewareMock = new Mock<IMiddleware<string, string>>();
        var thirdMiddlewareMock = new Mock<IMiddleware<string, string>>();
        firstMiddlewareMock.Setup(ExecuteAsyncWithAnyParams)
                           .Returns<string, CancellationToken, Func<Task<string>>>((input, ct, next) => next());
        secondMiddlewareMock.Setup(ExecuteAsyncWithAnyParams)
                            .Returns<string, CancellationToken, Func<Task<string>>>((input, ct, next) => next());
        thirdMiddlewareMock.Setup(ExecuteAsyncWithAnyParams)
                            .Returns<string, CancellationToken, Func<Task<string>>>((input, ct, next) => next());

        var middlewares = new List<MiddlewareConfig<string, string, IMiddleware<string, string>>>
        {
            new(firstMiddlewareMock.Object, null),
            new(secondMiddlewareMock.Object, _ => true),
            new(thirdMiddlewareMock.Object, _ => false)
        };

        var handler = new MiddlewareHandler<string, string, IMiddleware<string, string>>(middlewares);

        // Act
        await handler.ExecuteAsync((input, ct) => Task.FromResult("Base"), "Input", CancellationToken.None);

        // Assert
        firstMiddlewareMock.Verify(ExecuteAsyncWithAnyParams, Times.Once());
        secondMiddlewareMock.Verify(ExecuteAsyncWithAnyParams, Times.Once());
        thirdMiddlewareMock.Verify(ExecuteAsyncWithAnyParams, Times.Never());
    }

    [Fact]
    public async Task MiddlewareHandler_SkipsFollowingMiddlewares_IfNextIsNotCalled()
    {
        // Arrange
        var firstResult = "First";
        var firstMiddlewareMock = new Mock<IMiddleware<string, string>>();
        var secondMiddlewareMock = new Mock<IMiddleware<string, string>>();
        var thirdMiddlewareMock = new Mock<IMiddleware<string, string>>();
        firstMiddlewareMock.Setup(ExecuteAsyncWithAnyParams)
                           .Returns<string, CancellationToken, Func<Task<string>>>((input, ct, next) => Task.FromResult(firstResult));
        secondMiddlewareMock.Setup(ExecuteAsyncWithAnyParams)
                            .Returns<string, CancellationToken, Func<Task<string>>>((input, ct, next) => next());
        thirdMiddlewareMock.Setup(ExecuteAsyncWithAnyParams)
                            .Returns<string, CancellationToken, Func<Task<string>>>((input, ct, next) => next());

        var baseFunctionMock = new Mock<Func<string, CancellationToken, Task<string>>>();
        baseFunctionMock.Setup(InvokeWithAnyParams).ReturnsAsync(string.Empty);

        var handler = new MiddlewareHandler<string, string, IMiddleware<string, string>>(new List<IMiddleware<string, string>>
        {
            firstMiddlewareMock.Object, secondMiddlewareMock.Object, thirdMiddlewareMock.Object
        });

        // Act
        var result = await handler.ExecuteAsync(baseFunctionMock.Object, "Input", CancellationToken.None);

        // Assert
        result.Should().Be(firstResult);
        firstMiddlewareMock.Verify(ExecuteAsyncWithAnyParams, Times.Once());
        secondMiddlewareMock.Verify(ExecuteAsyncWithAnyParams, Times.Never());
        thirdMiddlewareMock.Verify(ExecuteAsyncWithAnyParams, Times.Never());
        baseFunctionMock.Verify(InvokeWithAnyParams, Times.Never());
    }

}