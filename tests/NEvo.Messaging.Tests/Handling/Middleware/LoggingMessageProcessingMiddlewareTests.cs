using LanguageExt;
using Microsoft.Extensions.Logging;
using NEvo.Messaging.Context;
using NEvo.Messaging.Handling;
using NEvo.Messaging.Handling.Middleware;

namespace NEvo.Messaging.Tests.Handling.Middleware;

public class LoggingMessageProcessingMiddlewareTests
{
    private readonly string _handlerName = "Handler name";
    private readonly Mock<ILogger<LoggingMessageProcessingMiddleware>> _loggerMock = new();
    private readonly Mock<Func<Task<Either<Exception, object>>>> _nextMock = new();
    private readonly Mock<IMessage> _messageMock = new();
    private readonly Mock<IMessageHandler> _messageHandlerMock = new();
    private readonly LoggingMessageProcessingMiddleware _middleware;

    public LoggingMessageProcessingMiddlewareTests()
    {
        _middleware = new LoggingMessageProcessingMiddleware(_loggerMock.Object);
        _messageMock.Setup(m => m.Id).Returns(Guid.NewGuid());
        var handlerDescription = new MessageHandlerDescription(_handlerName, GetType(), GetType(), GetType(), GetType(), null);
        _messageHandlerMock.Setup(m => m.HandlerDescription).Returns(handlerDescription);
        _nextMock.Setup(n => n.Invoke()).ReturnsAsync(Either<Exception, object>.Right(new object()));
    }

    [Fact]
    public async Task ExecuteAsync_WithMessage_LogsInformationOnSuccess()
    {
        // Act
        await _middleware.ExecuteAsync(_messageMock.Object, Mock.Of<IMessageContext>(), _nextMock.Object, CancellationToken.None);

        // Assert
        VerifyLogging("Processing message #", LogLevel.Information, Times.Exactly(2));
    }

    [Fact]
    public async Task ExecuteAsync_WithMessage_LogsErrorOnException()
    {
        // Arrange
        var exception = new Exception("Test exception");
        _nextMock.Setup(n => n.Invoke()).ReturnsAsync(Either<Exception, object>.Left(exception));

        // Act
        await _middleware.ExecuteAsync(_messageMock.Object, Mock.Of<IMessageContext>(), _nextMock.Object, CancellationToken.None);

        // Assert
        VerifyLogging("Processing message #", LogLevel.Error, Times.Once());
    }

    [Fact]
    public async Task ExecuteAsync_WithMessageHandler_LogsInformationOnSuccess()
    {
        // Act
        await _middleware.ExecuteAsync(_messageHandlerMock.Object, _messageMock.Object, Mock.Of<IMessageContext>(), _nextMock.Object, CancellationToken.None);

        // Assert
        VerifyLogging($"Handler {_handlerName} for message #", LogLevel.Information, Times.Exactly(2));
    }

    [Fact]
    public async Task ExecuteAsync_WithMessageHandler_LogsErrorOnException()
    {
        // Arrange
        var exception = new Exception("Test exception");
        _nextMock.Setup(n => n.Invoke()).ReturnsAsync(Either<Exception, object>.Left(exception));

        // Act
        await _middleware.ExecuteAsync(_messageHandlerMock.Object, _messageMock.Object, Mock.Of<IMessageContext>(), _nextMock.Object, CancellationToken.None);

        // Assert
        VerifyLogging($"Handler {_handlerName} for message #", LogLevel.Error, Times.Once());
    }

    private void VerifyLogging(string message, LogLevel level, Times times)
    {
        _loggerMock.Verify(
            x => x.Log(
                It.Is<LogLevel>(l => l == level),
                It.IsAny<EventId>(),
                It.Is<It.IsAnyType>((v, t) => v.ToString()!.Contains(message)),
                It.IsAny<Exception>(),
                It.IsAny<Func<It.IsAnyType, Exception?, string>>()),
            times);
    }
}
