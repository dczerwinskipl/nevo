﻿using LanguageExt;
using NEvo.Messaging.Context;
using NEvo.Messaging.Handling.Middleware;

namespace NEvo.Messaging.Tests.Handling.Middleware;

public class TransactionScopeMessageProcessingMiddlewareTests
{
    private readonly TransactionScopeMessageProcessingMiddleware _middleware = new();
    private readonly Mock<Func<Task<Either<Exception, object>>>> _nextMock = new();
    private readonly Mock<IMessageContext> _contextMock = new();

    public TransactionScopeMessageProcessingMiddlewareTests()
    {
        _nextMock.Setup(n => n.Invoke()).ReturnsAsync(Either<Exception, object>.Right(new object()));
        _contextMock.Setup(m => m.GetFeature<ThreadingOptions>()).Returns(new ThreadingOptions());
    }

    [Fact]
    public async Task ExecuteAsync_CompletesTransaction_OnSuccess()
    {
        // Act
        var result = await _middleware.ExecuteAsync(Mock.Of<IMessage>(), _contextMock.Object, _nextMock.Object, CancellationToken.None);

        // Assert
        _nextMock.Verify(n => n.Invoke(), Times.Once);
        result.ExpectRight();
    }

    [Fact]
    public async Task ExecuteAsync_MaintainsFailure_WithoutCompletingTransaction()
    {
        // Arrange
        var expectedException = new Exception();
        _nextMock.Setup(n => n.Invoke()).ReturnsAsync(Either<Exception, object>.Left(expectedException));

        // Act
        var result = await _middleware.ExecuteAsync(Mock.Of<IMessage>(), _contextMock.Object, _nextMock.Object, CancellationToken.None);

        // Assert
        _nextMock.Verify(n => n.Invoke(), Times.Once);
        result.ExpectLeft().Should().Be(expectedException);
    }
}