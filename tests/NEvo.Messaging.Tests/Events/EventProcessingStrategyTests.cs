using LanguageExt;
using NEvo.Messaging.Context;
using NEvo.Messaging.Events;
using NEvo.Messaging.Handling;

namespace NEvo.Messaging.Tests.Events;

public class EventProcessingStrategyTests
{
    private readonly Mock<IMessageHandlerRegistry> _messageHandlerRegistryMock = new();
    private readonly IMessageContext _messageContext;
    private readonly EventProcessingStrategy _sut;

    public EventProcessingStrategyTests()
    {
        var serviceProciderMock = new Mock<IServiceProvider>();
        var messageContextMock = new Mock<IMessageContext>();
        messageContextMock.Setup(m => m.ServiceProvider).Returns(serviceProciderMock.Object);
        _messageContext = messageContextMock.Object;

        _sut = new EventProcessingStrategy(_messageHandlerRegistryMock.Object);
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