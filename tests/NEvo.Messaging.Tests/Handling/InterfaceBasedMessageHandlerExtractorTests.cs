using LanguageExt.ClassInstances;
using NEvo.Messaging.Handling;
using NEvo.Messaging.Tests.Handling.Mocks;

namespace NEvo.Messaging.Tests.Handling;

public class InterfaceBasedMessageHandlerExtractorTests
{
    [Fact]
    public void ExtractMessageHandlers_ReturnsCorrectHandlers_ForGivenHandlerType()
    {
        // Arrange
        var messageHandlerFactoryMock = new Mock<IMessageHandlerFactory>();
        var messageHandlerDescription = new MessageHandlerDescription("Key", typeof(ExampleMessageA), typeof(ExampleMessageA), typeof(IExampleMessageHandler<>), typeof(void), null);
        var handlerInstance = new Mock<IMessageHandler>().Object;

        messageHandlerFactoryMock
            .Setup(m => m.CanApply(typeof(ExampleMessageHandlerA)))
            .Returns(true);
        messageHandlerFactoryMock
            .Setup(m => m.GetMessageHandlerDescriptions(typeof(ExampleMessageHandlerA)))
            .Returns([
                messageHandlerDescription
            ]);
        messageHandlerFactoryMock
            .Setup(m => m.Create(messageHandlerDescription))
            .Returns(handlerInstance);

        var factories = new List<IMessageHandlerFactory>
        {
            messageHandlerFactoryMock.Object
        };

        var extractor = new InterfaceBasedMessageHandlerExtractor(factories);

        // Act
        var handlers = extractor.ExtractMessageHandlers(typeof(ExampleMessageHandlerA));

        // Assert
        handlers.Should().NotBeNull()
            .And.ContainKey(typeof(ExampleMessageA), because: "the extractor should return a handler for the specified message type")
            .WhoseValue.Should().Be(handlerInstance, because: "the factory should create a handler instance for the message type");
    }
}
