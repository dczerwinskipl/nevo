using NEvo.Messaging.Handling.Exceptions;
using NEvo.Messaging.Handling;
using LanguageExt;

namespace NEvo.Messaging.Tests.Handling;

public class MessageHandlerRegistryTests
{
    private readonly Mock<IMessageHandlerExtractor> _messageHandlerExtractorMock = new();
    private readonly MessageHandlerRegistry _registry;

    public MessageHandlerRegistryTests()
    {
        _registry = new MessageHandlerRegistry(_messageHandlerExtractorMock.Object);
    }

    [Fact]
    public void Register_AddsHandlersCorrectly()
    {
        // Arrange
        var messageType = typeof(IMessage);
        var handlerMock = new Mock<IMessageHandler>();
        _messageHandlerExtractorMock.Setup(extractor => extractor.ExtractMessageHandlers<IMessageHandler>())
            .Returns(new Dictionary<Type, IMessageHandler> { { messageType, handlerMock.Object } });

        // Act
        _registry.Register<IMessageHandler>();
        var handlers = _registry.GetMessageHandlers(messageType);

        // Assert
        handlers.Should().ContainSingle().Which.Should().Be(handlerMock.Object);
    }

    [Fact]
    public void GetMessageHandler_ReturnsSingleHandler_WhenOneExists()
    {
        // Arrange
        var messageType = typeof(IMessage);
        var handlerMock = new Mock<IMessageHandler>();
        _messageHandlerExtractorMock.Setup(extractor => extractor.ExtractMessageHandlers<IMessageHandler>())
            .Returns(new Dictionary<Type, IMessageHandler> { { messageType, handlerMock.Object } });

        _registry.Register<IMessageHandler>();

        // Act
        var result = _registry.GetMessageHandler(messageType);

        // Assert
        result.ExpectRight().Should().Be(handlerMock.Object);
    }

    [Fact]
    public void GetMessageHandler_ReturnsError_WhenNoHandlersFound()
    {
        // Arrange
        var messageType = typeof(IMessage);

        // Act
        var result = _registry.GetMessageHandler(messageType);

        // Assert
        result.ExpectLeft().Should().BeOfType<NoHandlerFoundException>();
    }

    [Fact]
    public void GetMessageHandler_ReturnsError_WhenMultipleHandlersFound()
    {
        // Arrange
        var messageType = typeof(IMessage);
        var handlerMock = new Mock<IMessageHandler>();
        handlerMock.Setup(m => m.HandlerDescription).Returns(new MessageHandlerDescription("Handler key", typeof(IMessageHandler), typeof(IMessage), typeof(IMessageHandler)));
        _messageHandlerExtractorMock.Setup(extractor => extractor.ExtractMessageHandlers<IMessageHandler>())
            .Returns(new Dictionary<Type, IMessageHandler> {
                { messageType, handlerMock.Object }
            });

        _registry.Register<IMessageHandler>();
        _registry.Register<IMessageHandler>();

        // Act
        var result = _registry.GetMessageHandler(messageType);

        // Assert
        result.ExpectLeft().Should().BeOfType<MoreThanOneHandlerFoundException>();
    }


    [Fact]
    public void GetMessageHandlerWithType_ReturnsSingleHandler_WhenOneExists()
    {
        // Arrange
        var messageType = typeof(IMessage);
        var handlerMock = new Mock<IMessageHandler>() { CallBase = true };
        handlerMock.Setup(m => m.HandlerDescription).Returns(new MessageHandlerDescription("Handler key", typeof(IMessageHandler), typeof(IMessage), typeof(IMessageHandler), typeof(Unit)));
        _messageHandlerExtractorMock.Setup(extractor => extractor.ExtractMessageHandlers<IMessageHandler>())
            .Returns(new Dictionary<Type, IMessageHandler> { { messageType, handlerMock.Object } });

        _registry.Register<IMessageHandler>();

        // Act
        var result = _registry.GetMessageHandler<Unit>(messageType);

        // Assert
        result.ExpectRight().Should().Be(handlerMock.Object);
    }

    [Fact]
    public void GetMessageHandlerWithType_ReturnsError_WhenNoHandlersFound()
    {
        // Arrange
        var messageType = typeof(IMessage);

        // Act
        var result = _registry.GetMessageHandler<Unit>(messageType);

        // Assert
        result.ExpectLeft().Should().BeOfType<NoHandlerFoundException>();
    }

    [Fact]
    public void GetMessageHandlerWithType_ReturnsError_WhenMultipleHandlersFound()
    {
        // Arrange
        var messageType = typeof(IMessage);
        var handlerMock = new Mock<IMessageHandler>() { CallBase = true };
        handlerMock.Setup(m => m.HandlerDescription).Returns(new MessageHandlerDescription("Handler key", typeof(IMessageHandler), typeof(IMessage), typeof(IMessageHandler), typeof(Unit)));
        _messageHandlerExtractorMock.Setup(extractor => extractor.ExtractMessageHandlers<IMessageHandler>())
            .Returns(new Dictionary<Type, IMessageHandler> {
                { messageType, handlerMock.Object }
            });

        _registry.Register<IMessageHandler>();
        _registry.Register<IMessageHandler>();

        // Act
        var result = _registry.GetMessageHandler<Unit>(messageType);

        // Assert
        result.ExpectLeft().Should().BeOfType<MoreThanOneHandlerFoundException>();
    }
}
