using LanguageExt;
using NEvo.Messaging.Context;
using NEvo.Messaging.Handling;
using NEvo.Messaging.Handling.Middleware;
using Polly;

namespace NEvo.Messaging.Tests.Handling.Middleware;

public class PollyPolicyMessageProcessingMiddlewareTests
{
    private readonly Mock<IPollyMessageHandlingPolicyProvider> _policyProviderMock = new();
    private readonly Mock<IAsyncPolicy<Either<Exception, object>>> _policyMock = new();
    private readonly Mock<Func<Task<Either<Exception, object>>>> _nextMock = new();
    private readonly PollyPolicyMessageProcessingMiddleware _middleware;

    public PollyPolicyMessageProcessingMiddlewareTests()
    {
        _middleware = new PollyPolicyMessageProcessingMiddleware(_policyProviderMock.Object);
        _policyProviderMock.Setup(x => x.For(It.IsAny<IMessageHandler>(), It.IsAny<IMessage>(), It.IsAny<IMessageContext>()))
                           .Returns(_policyMock.Object);
        _policyMock.Setup(p => p.ExecuteAsync(It.IsAny<Func<Task<Either<Exception, object>>>>()))
                   .Returns<Func<Task<Either<Exception, object>>>>((func) => func());
        _nextMock.Setup(n => n.Invoke()).ReturnsAsync(Either<Exception, object>.Right(new object()));
    }

    [Fact]
    public async Task ExecuteAsync_InvokesNext_AndReturnsItsResult()
    {
        // Arrange
        var messageHandlerMock = new Mock<IMessageHandler>();
        var messageMock = new Mock<IMessage>();
        var contextMock = new Mock<IMessageContext>();

        // Act
        var result = await _middleware.ExecuteAsync(messageHandlerMock.Object, messageMock.Object, contextMock.Object, _nextMock.Object, CancellationToken.None);

        // Assert
        _policyProviderMock.Verify(x => x.For(messageHandlerMock.Object, messageMock.Object, contextMock.Object), Times.Once);
        _policyMock.Verify(p => p.ExecuteAsync(It.IsAny<Func<Task<Either<Exception, object>>>>()), Times.Once);
        _nextMock.Verify(n => n.Invoke(), Times.Once);
        result.ExpectRight().Should().NotBeNull();
    }

    [Fact]
    public async Task ExecuteAsync_HandlesPolicyExecutionFailure()
    {
        // Arrange
        var expectedException = new Exception();
        _policyMock.Setup(p => p.ExecuteAsync(It.IsAny<Func<Task<Either<Exception, object>>>>()))
                   .ReturnsAsync(Either<Exception, object>.Left(expectedException));

        // Act
        var result = await _middleware.ExecuteAsync(Mock.Of<IMessageHandler>(), Mock.Of<IMessage>(), Mock.Of<IMessageContext>(), _nextMock.Object, CancellationToken.None);

        // Assert
        result.ExpectLeft().Should().Be(expectedException);
    }
}
