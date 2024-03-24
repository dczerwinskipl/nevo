using LanguageExt;
using NEvo.Messaging.Context;
using NEvo.Messaging.Handling.Middleware;

namespace NEvo.Messaging.Tests.Handling.Middleware;

public class TransactionScopeMessageProcessingMiddlewareTests
{
    private readonly TransactionScopeMessageProcessingMiddleware _middleware = new TransactionScopeMessageProcessingMiddleware();
    private readonly Mock<Func<Task<Either<Exception, object>>>> _nextMock = new();

    public TransactionScopeMessageProcessingMiddlewareTests()
    {
        _nextMock.Setup(n => n.Invoke()).ReturnsAsync(Either<Exception, object>.Right(new object()));
    }

    [Fact]
    public async Task ExecuteAsync_CompletesTransaction_OnSuccess()
    {
        // Act
        var result = await _middleware.ExecuteAsync(Mock.Of<IMessage>(), Mock.Of<IMessageContext>(), _nextMock.Object, CancellationToken.None);

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
        var result = await _middleware.ExecuteAsync(Mock.Of<IMessage>(), Mock.Of<IMessageContext>(), _nextMock.Object, CancellationToken.None);

        // Assert
        _nextMock.Verify(n => n.Invoke(), Times.Once); // Verify that next was called
        result.ExpectLeft().Should().Be(expectedException);
    }
}