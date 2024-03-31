using LanguageExt;
using NEvo.Core;
using NEvo.Messaging.Context;
using NEvo.Messaging.Events;
using NEvo.Messaging.Handling;

namespace NEvo.Messaging.Tests.Events;

public class ParallelEventProcessingStrategyTests
{
    private readonly IMessageContext _messageContext;
    private readonly Mock<IMessageHandlerRegistry> _messageHandlerRegistryMock = new();
    private readonly Mock<IMiddlewareHandler<(IMessageHandler, IMessage, IMessageContext), Either<Exception, object>>> _middlewareMock = new();
    private readonly Mock<IServiceProvider> _serviceProciderMock = new();
    private readonly ParallelEventProcessingStrategy _sut;

    public ParallelEventProcessingStrategyTests()
    {
        var messageContextMock = new Mock<IMessageContext>();
        messageContextMock.Setup(m => m.ServiceProvider).Returns(_serviceProciderMock.Object);
        _messageContext = messageContextMock.Object;
        _middlewareMock
            .Setup(m => m.ExecuteAsync(It.IsAny<Func<(IMessageHandler, IMessage, IMessageContext), CancellationToken, Task<Either<Exception, object>>>>(), It.IsAny<(IMessageHandler, IMessage, IMessageContext)>(), It.IsAny<CancellationToken>()))
            .Returns(
                (
                    Func<(IMessageHandler, IMessage, IMessageContext), CancellationToken, Task<Either<Exception, object>>> baseDelegate,
                    (IMessageHandler, IMessage, IMessageContext) input,
                    CancellationToken cancellationToken
                ) => baseDelegate(input, cancellationToken));
        _sut = new ParallelEventProcessingStrategy(_messageHandlerRegistryMock.Object, _middlewareMock.Object);
    }

    [Fact]
    public void ShouldApply_ReturnsTrue_ForEvent()
    {
        // Arrange
        var eventMessage = new Event();

        // Act
        var shouldApply = _sut.ShouldApply(eventMessage, _messageContext);

        // Assert
        shouldApply.Should().BeTrue();
    }

    [Fact]
    public void ShouldApply_ReturnsFalse_ForNonEvent()
    {
        // Arrange
        var nonEventMessage = Mock.Of<IMessage>();

        // Act
        var shouldApply = _sut.ShouldApply(nonEventMessage, _messageContext);

        // Assert
        shouldApply.Should().BeFalse();
    }

    [Fact]
    public async Task ProcessMessageAsync_ProcessesMessage_WithNoFailures()
    {
        // Arrange
        var eventMessage = new Event();
        var handlerMock = new Mock<IMessageHandler>();
        handlerMock.Setup(h => h.HandleAsync(eventMessage, It.IsAny<IMessageContext>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Either<Exception, object>.Right(Unit.Default));

        _messageHandlerRegistryMock.Setup(registry => registry.GetMessageHandlers(eventMessage))
            .Returns([handlerMock.Object]);

        // Act
        var result = await _sut.ProcessMessageAsync(eventMessage, _messageContext, CancellationToken.None);

        // Assert
        result.ExpectRight().Should().Be(Unit.Default);
        handlerMock.Verify(h => h.HandleAsync(eventMessage, It.IsAny<IMessageContext>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task ProcessMessageAsync_AggregatesFailures_WhenHandlersFail()
    {
        // Arrange
        var eventMessage = new Event();
        var handlerMock = new Mock<IMessageHandler>();
        var exception = new Exception();
        handlerMock.Setup(h => h.HandleAsync(eventMessage, It.IsAny<IMessageContext>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Either<Exception, object>.Left(exception));

        _messageHandlerRegistryMock.Setup(registry => registry.GetMessageHandlers(eventMessage))
            .Returns([handlerMock.Object]);

        // Act
        var result = await _sut.ProcessMessageAsync(eventMessage, _messageContext, CancellationToken.None);

        // Assert
        result.ExpectLeft().Should().BeOfType<AggregateException>()
            .Which.InnerException.Should().Be(exception);
    }
}