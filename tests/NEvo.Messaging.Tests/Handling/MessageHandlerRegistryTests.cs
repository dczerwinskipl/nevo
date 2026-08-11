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


    // Primary/Fallback role resolution (D3, area handler-registration-and-options,
    // task 05). Role-aware resolution activates only when at least one candidate
    // carries a Role tag — the tests above (no Role anywhere) already prove that an
    // untagged message type resolves exactly as before this rule existed.

    [Fact]
    public void GetMessageHandler_ReturnsFallback_WhenOnlyFallbackHandlerRegistered()
    {
        // Arrange
        var messageType = typeof(IMessage);
        var fallbackMock = new Mock<IMessageHandler>();
        fallbackMock.Setup(m => m.HandlerDescription).Returns(new MessageHandlerDescription("Fallback", typeof(IMessageHandler), messageType, typeof(IMessageHandler), Role: HandlerRole.Fallback));
        var providerMock = new Mock<IMessageHandlerProvider>();
        providerMock.Setup(p => p.GetMessageHandlers())
            .Returns(new Dictionary<Type, IEnumerable<IMessageHandler>> { { messageType, [fallbackMock.Object] } });
        var registry = new MessageHandlerRegistry([providerMock.Object]);

        // Act
        var result = registry.GetMessageHandler(messageType);

        // Assert
        result.ExpectRight().Should().Be(fallbackMock.Object);
    }

    [Fact]
    public void GetMessageHandler_ReturnsPrimary_WhenOnePrimaryAndOneFallbackRegistered()
    {
        // Arrange
        var messageType = typeof(IMessage);
        var primaryMock = new Mock<IMessageHandler>();
        primaryMock.Setup(m => m.HandlerDescription).Returns(new MessageHandlerDescription("Primary", typeof(IMessageHandler), messageType, typeof(IMessageHandler), Role: HandlerRole.Primary));
        var fallbackMock = new Mock<IMessageHandler>();
        fallbackMock.Setup(m => m.HandlerDescription).Returns(new MessageHandlerDescription("Fallback", typeof(IMessageHandler), messageType, typeof(IMessageHandler), Role: HandlerRole.Fallback));
        var providerMock = new Mock<IMessageHandlerProvider>();
        providerMock.Setup(p => p.GetMessageHandlers())
            .Returns(new Dictionary<Type, IEnumerable<IMessageHandler>> { { messageType, [fallbackMock.Object, primaryMock.Object] } });
        var registry = new MessageHandlerRegistry([providerMock.Object]);

        // Act
        var result = registry.GetMessageHandler(messageType);

        // Assert
        result.ExpectRight().Should().Be(primaryMock.Object);
    }

    [Fact]
    public void GetMessageHandler_ReturnsError_WhenTwoPrimaryCandidatesRegistered()
    {
        // Arrange
        var messageType = typeof(IMessage);
        var primary1 = new Mock<IMessageHandler>();
        primary1.Setup(m => m.HandlerDescription).Returns(new MessageHandlerDescription("Primary1", typeof(IMessageHandler), messageType, typeof(IMessageHandler), Role: HandlerRole.Primary));
        var primary2 = new Mock<IMessageHandler>();
        primary2.Setup(m => m.HandlerDescription).Returns(new MessageHandlerDescription("Primary2", typeof(IMessageHandler), messageType, typeof(IMessageHandler), Role: HandlerRole.Primary));
        var providerMock = new Mock<IMessageHandlerProvider>();
        providerMock.Setup(p => p.GetMessageHandlers())
            .Returns(new Dictionary<Type, IEnumerable<IMessageHandler>> { { messageType, [primary1.Object, primary2.Object] } });
        var registry = new MessageHandlerRegistry([providerMock.Object]);

        // Act
        var result = registry.GetMessageHandler(messageType);

        // Assert
        result.ExpectLeft().Should().BeOfType<MoreThanOneHandlerFoundException>();
    }

    [Fact]
    public void GetMessageHandler_ReturnsError_WhenTwoFallbackCandidatesRegistered()
    {
        // Arrange
        var messageType = typeof(IMessage);
        var fallback1 = new Mock<IMessageHandler>();
        fallback1.Setup(m => m.HandlerDescription).Returns(new MessageHandlerDescription("Fallback1", typeof(IMessageHandler), messageType, typeof(IMessageHandler), Role: HandlerRole.Fallback));
        var fallback2 = new Mock<IMessageHandler>();
        fallback2.Setup(m => m.HandlerDescription).Returns(new MessageHandlerDescription("Fallback2", typeof(IMessageHandler), messageType, typeof(IMessageHandler), Role: HandlerRole.Fallback));
        var providerMock = new Mock<IMessageHandlerProvider>();
        providerMock.Setup(p => p.GetMessageHandlers())
            .Returns(new Dictionary<Type, IEnumerable<IMessageHandler>> { { messageType, [fallback1.Object, fallback2.Object] } });
        var registry = new MessageHandlerRegistry([providerMock.Object]);

        // Act
        var result = registry.GetMessageHandler(messageType);

        // Assert
        result.ExpectLeft().Should().BeOfType<MoreThanOneHandlerFoundException>();
    }

    [Fact]
    public void GetMessageHandler_ReturnsError_WhenARoleTaggedHandlerIsMixedWithAnUntaggedOne()
    {
        // Arrange
        var messageType = typeof(IMessage);
        var primaryMock = new Mock<IMessageHandler>();
        primaryMock.Setup(m => m.HandlerDescription).Returns(new MessageHandlerDescription("Primary", typeof(IMessageHandler), messageType, typeof(IMessageHandler), Role: HandlerRole.Primary));
        var untaggedMock = new Mock<IMessageHandler>();
        untaggedMock.Setup(m => m.HandlerDescription).Returns(new MessageHandlerDescription("Untagged", typeof(IMessageHandler), messageType, typeof(IMessageHandler)));
        var providerMock = new Mock<IMessageHandlerProvider>();
        providerMock.Setup(p => p.GetMessageHandlers())
            .Returns(new Dictionary<Type, IEnumerable<IMessageHandler>> { { messageType, [primaryMock.Object, untaggedMock.Object] } });
        var registry = new MessageHandlerRegistry([providerMock.Object]);

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
