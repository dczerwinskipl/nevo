using LanguageExt;
using Microsoft.Win32;
using NEvo.Messaging.Handling;
using NEvo.Messaging.Handling.Exceptions;

namespace NEvo.Messaging.Tests.Handling;

public class MessageHandlerRegistryTests
{
    [Fact]
    public void GetMessageHandler_ReturnsSingleHandler_WhenOneExists()
    {
        // Arrange
        var messageType = typeof(IMessage);
        var handlerMock = new Mock<IMessageHandler>();
        var messageHandlerExtractorMock = new Mock<IMessageHandlerProvider>();
        messageHandlerExtractorMock.Setup(extractor => extractor.GetMessageHandlers())
            .Returns(new Dictionary<Type, IEnumerable<IMessageHandler>> { { messageType, [handlerMock.Object] } });
        var registry = new MessageHandlerRegistry([messageHandlerExtractorMock.Object]);

        // Act
        var result = registry.GetMessageHandler(messageType);

        // Assert
        result.ExpectRight().Should().Be(handlerMock.Object);
    }

    [Fact]
    public void GetMessageHandler_ReturnsError_WhenNoHandlersFound()
    {
        // Arrange
        var messageType = typeof(IMessage);
        var registry = new MessageHandlerRegistry([]);

        // Act
        var result = registry.GetMessageHandler(messageType);

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
        var messageHandlerExtractorMock = new Mock<IMessageHandlerProvider>();
        messageHandlerExtractorMock.Setup(extractor => extractor.GetMessageHandlers())
            .Returns(new Dictionary<Type, IEnumerable<IMessageHandler>> { { messageType, [handlerMock.Object, handlerMock.Object] } });
        var registry = new MessageHandlerRegistry([messageHandlerExtractorMock.Object]);

        // Act
        var result = registry.GetMessageHandler(messageType);

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
        var messageHandlerExtractorMock = new Mock<IMessageHandlerProvider>();
        messageHandlerExtractorMock.Setup(extractor => extractor.GetMessageHandlers())
            .Returns(new Dictionary<Type, IEnumerable<IMessageHandler>> { { messageType, [handlerMock.Object] } });
        var registry = new MessageHandlerRegistry([messageHandlerExtractorMock.Object]);

        // Act
        var result = registry.GetMessageHandler<Unit>(messageType);

        // Assert
        result.ExpectRight().Should().Be(handlerMock.Object);
    }

    [Fact]
    public void GetMessageHandlerWithType_ReturnsError_WhenNoHandlersFound()
    {
        // Arrange
        var messageType = typeof(IMessage);
        var registry = new MessageHandlerRegistry([]);

        // Act
        var result = registry.GetMessageHandler<Unit>(messageType);

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
        var messageHandlerExtractorMock = new Mock<IMessageHandlerProvider>();
        messageHandlerExtractorMock.Setup(extractor => extractor.GetMessageHandlers())
            .Returns(new Dictionary<Type, IEnumerable<IMessageHandler>> { { messageType, [handlerMock.Object, handlerMock.Object] } });
        var registry = new MessageHandlerRegistry([messageHandlerExtractorMock.Object]);

        // Act
        var result = registry.GetMessageHandler<Unit>(messageType);

        // Assert
        result.ExpectLeft().Should().BeOfType<MoreThanOneHandlerFoundException>();
    }
}
