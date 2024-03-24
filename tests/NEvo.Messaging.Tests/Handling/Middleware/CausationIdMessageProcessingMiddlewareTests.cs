using LanguageExt;
using NEvo.Messaging.Context;
using NEvo.Messaging.Handling.Middleware;

namespace NEvo.Messaging.Tests.Handling.Middleware;

public class CausationIdMessageProcessingMiddlewareTests
{
    private readonly Mock<IMessage> _messageMock = new();
    private readonly Mock<IMessageContextHeaders> _headersMock = new();
    private readonly Mock<IMessageContext> _contextMock = new();
    private readonly Mock<Func<Task<Either<Exception, object>>>> _nextMock = new();

    public CausationIdMessageProcessingMiddlewareTests()
    {
        _contextMock.SetupGet(c => c.Headers).Returns(_headersMock.Object);
        _messageMock.SetupGet(m => m.Id).Returns(Guid.NewGuid());
        _nextMock.Setup(n => n.Invoke()).ReturnsAsync(Either<Exception, object>.Right(new object()));
    }

    [Fact]
    public async Task ExecuteAsync_SetsCausationId_WhenNoneExists()
    {
        // Arrange
        var messageId = Guid.NewGuid();
        _messageMock.Setup(m => m.Id).Returns(messageId);
        var noneOption = Option<string>.None;
        _headersMock.SetupProperty(h => h.CausationId, noneOption);
        var middleware = new CausationIdMessageProcessingMiddleware();

        // Act
        await middleware.ExecuteAsync(_messageMock.Object, _contextMock.Object, _nextMock.Object, CancellationToken.None);

        // Assert
        _contextMock.Object.Headers.CausationId.ExpectSome().Should().Be(messageId.ToString());
    }

    [Fact]
    public async Task ExecuteAsync_SkipSettingCausationId_WhenAlreadyExists()
    {
        // Arrange
        var originalCausationId = Guid.NewGuid().ToString();
        _headersMock.SetupProperty(h => h.CausationId, originalCausationId);
        var middleware = new CausationIdMessageProcessingMiddleware();

        // Act
        await middleware.ExecuteAsync(_messageMock.Object, _contextMock.Object, _nextMock.Object, CancellationToken.None);

        // Assert
        _contextMock.Object.Headers.CausationId.ExpectSome().Should().Be(originalCausationId);
    }

    [Fact]
    public async Task ExecuteAsync_CallsNextMiddleware()
    {
        // Arrange
        var expectedResult = new object();
        _nextMock.Setup(n => n.Invoke()).ReturnsAsync(Either<Exception, object>.Right(expectedResult));
        var middleware = new CausationIdMessageProcessingMiddleware();

        // Act
        var result = await middleware.ExecuteAsync(_messageMock.Object, _contextMock.Object, _nextMock.Object, CancellationToken.None);

        // Assert
        _nextMock.Verify(n => n.Invoke(), Times.Once);
        result.ExpectRight().Should().Be(expectedResult);
    }
}
