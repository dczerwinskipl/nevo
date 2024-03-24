using LanguageExt;
using NEvo.Messaging.Context;
using NEvo.Messaging.Handling.Middleware;

namespace NEvo.Messaging.Tests.Handling.Middleware;

public class CorrelationIdMessageProcessingMiddlewareTests
{
    private readonly Mock<IMessage> _messageMock = new();
    private readonly Mock<IMessageContextHeaders> _headersMock = new();
    private readonly Mock<IMessageContext> _contextMock = new();
    private readonly Mock<Func<Task<Either<Exception, object>>>> _nextMock = new();

    public CorrelationIdMessageProcessingMiddlewareTests()
    {
        _contextMock.SetupGet(c => c.Headers).Returns(_headersMock.Object);
        _messageMock.SetupGet(m => m.Id).Returns(Guid.NewGuid());
        _nextMock.Setup(n => n.Invoke()).ReturnsAsync(Either<Exception, object>.Right(new object()));
    }

    [Fact]
    public async Task ExecuteAsync_SetsCorrelationId_WhenNoneExists()
    {
        // Arrange
        var noneOption = Option<string>.None;
        _headersMock.SetupProperty(h => h.CorrelationId, noneOption);
        var middleware = new CorrelationIdMessageProcessingMiddleware();

        // Act
        await middleware.ExecuteAsync(_messageMock.Object, _contextMock.Object, _nextMock.Object, CancellationToken.None);

        // Assert
        _contextMock.Object.Headers.CorrelationId.ExpectSome();
    }

    [Fact]
    public async Task ExecuteAsync_SkipSettingCorrelationId_WhenAlreadyExists()
    {
        // Arrange
        var originalCorrelationId = Guid.NewGuid().ToString();
        _headersMock.SetupProperty(h => h.CorrelationId, originalCorrelationId);
        var middleware = new CorrelationIdMessageProcessingMiddleware();

        // Act
        await middleware.ExecuteAsync(_messageMock.Object, _contextMock.Object, _nextMock.Object, CancellationToken.None);

        // Assert
        _contextMock.Object.Headers.CorrelationId.ExpectSome().Should().Be(originalCorrelationId);
    }

    [Fact]
    public async Task ExecuteAsync_CallsNextMiddleware()
    {
        // Arrange
        var expectedResult = new object();
        _nextMock.Setup(n => n.Invoke()).ReturnsAsync(Either<Exception, object>.Right(expectedResult));
        var middleware = new CorrelationIdMessageProcessingMiddleware();

        // Act
        var result = await middleware.ExecuteAsync(_messageMock.Object, _contextMock.Object, _nextMock.Object, CancellationToken.None);

        // Assert
        _nextMock.Verify(n => n.Invoke(), Times.Once);
        result.ExpectRight().Should().Be(expectedResult);
    }
}