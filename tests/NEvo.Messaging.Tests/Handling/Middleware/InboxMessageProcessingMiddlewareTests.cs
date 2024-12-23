using LanguageExt;
using NEvo.Messaging.Context;
using NEvo.Messaging.Handling;
using NEvo.Messaging.Handling.Middleware;

namespace NEvo.Messaging.Tests.Handling.Middleware;

public class InboxMessageProcessingMiddlewareTests
{
    private readonly Mock<IMessage> _messageMock = new();
    private readonly Mock<IMessageHandler> _messageHandlerMock = new();
    private readonly Mock<IMessageContext> _contextMock = new();
    private readonly Mock<IMessageInbox> _messageInboxMock = new();
    private readonly Mock<Func<Task<Either<Exception, object>>>> _nextMock = new();

    public InboxMessageProcessingMiddlewareTests()
    {
        _nextMock.Setup(n => n.Invoke()).ReturnsAsync(Either<Exception, object>.Right(new object()));
        _contextMock.Setup(m => m.GetFeature<ThreadingOptions>()).Returns(new ThreadingOptions());
    }

    [Fact]
    public async Task ExecuteAsync_WithMessage_SkipsNext_IfAlreadyProcessed()
    {
        // Arrange
        _messageInboxMock.Setup(m => m.IsAlreadyProcessed(_messageMock.Object, _contextMock.Object)).Returns(true);
        var middleware = new InboxMessageProcessingMiddleware(_messageInboxMock.Object);

        // Act
        var result = await middleware.ExecuteAsync(_messageMock.Object, _contextMock.Object, _nextMock.Object, CancellationToken.None);

        // Assert
        _nextMock.Verify(n => n.Invoke(), Times.Never);
        result.ExpectRight().Should().Be(Unit.Default);
    }

    [Fact]
    public async Task ExecuteAsync_WithMessage_CallsNext_IfNotAlreadyProcessed()
    {
        // Arrange
        _messageInboxMock.Setup(m => m.IsAlreadyProcessed(_messageMock.Object, _contextMock.Object)).Returns(false);
        var middleware = new InboxMessageProcessingMiddleware(_messageInboxMock.Object);

        // Act
        await middleware.ExecuteAsync(_messageMock.Object, _contextMock.Object, _nextMock.Object, CancellationToken.None);

        // Assert
        _nextMock.Verify(n => n.Invoke(), Times.Once);
        _messageInboxMock.Verify(m => m.RegisterProcessedAsync(_messageMock.Object, _contextMock.Object), Times.Once);
    }

    [Fact]
    public async Task ExecuteAsync_WithMessageHandler_SkipsNext_IfAlreadyProcessed()
    {
        // Arrange
        _messageInboxMock.Setup(m => m.IsAlreadyProcessed(_messageHandlerMock.Object, _messageMock.Object, _contextMock.Object)).Returns(true);
        var middleware = new InboxMessageProcessingMiddleware(_messageInboxMock.Object);

        // Act
        var result = await middleware.ExecuteAsync(_messageHandlerMock.Object, _messageMock.Object, _contextMock.Object, _nextMock.Object, CancellationToken.None);

        // Assert
        _nextMock.Verify(n => n.Invoke(), Times.Never);
        result.ExpectRight().Should().Be(Unit.Default);
    }

    [Fact]
    public async Task ExecuteAsync_WithMessageHandler_CallsNext_IfNotAlreadyProcessed()
    {
        // Arrange
        _messageInboxMock.Setup(m => m.IsAlreadyProcessed(_messageHandlerMock.Object, _messageMock.Object, _contextMock.Object)).Returns(false);
        var middleware = new InboxMessageProcessingMiddleware(_messageInboxMock.Object);

        // Act
        await middleware.ExecuteAsync(_messageHandlerMock.Object, _messageMock.Object, _contextMock.Object, _nextMock.Object, CancellationToken.None);

        // Assert
        _nextMock.Verify(n => n.Invoke(), Times.Once);
        _messageInboxMock.Verify(m => m.RegisterProcessedAsync(_messageHandlerMock.Object, _messageMock.Object, _contextMock.Object), Times.Once);
    }
}
