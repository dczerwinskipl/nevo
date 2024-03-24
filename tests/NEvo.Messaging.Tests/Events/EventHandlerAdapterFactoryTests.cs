using LanguageExt;
using Microsoft.Extensions.Logging;
using NEvo.Messaging.Context;
using NEvo.Messaging.Events;
using NEvo.Messaging.Handling;

namespace NEvo.Messaging.Tests.Events;

public class EventHandlerAdapterFactoryTests
{
    private readonly ILogger<EventHandlerAdapter> _mockLogger;

    public EventHandlerAdapterFactoryTests()
    {
        _mockLogger = Mock.Of<ILogger<EventHandlerAdapter>>();
    }

    [Fact]
    public void ForInterface_ShouldReturnIEventHandlerGenericType()
    {
        // Arrange
        var factory = new EventHandlerAdapterFactory(_mockLogger);

        // Act
        var forInterface = factory.ForInterface;

        // Assert
        forInterface.Should().Be(typeof(IEventHandler<>));
    }

    [Fact]
    public void Create_ShouldReturnEventHandlerAdapter()
    {
        // Arrange
        var factory = new EventHandlerAdapterFactory(_mockLogger);
        var description = new MessageHandlerDescription(
            "Key",
            typeof(EventHandlerMock),
            typeof(EventMock),
            typeof(IEventHandler<>)
        );

        // Act
        var handler = factory.Create(description);

        // Assert
        handler.Should().BeOfType<EventHandlerAdapter>();
        (handler as EventHandlerAdapter).Should().NotBeNull();
    }

    [Fact]
    public void GetMessageHandlerDescriptions_ShouldYieldCorrectDescription()
    {
        // Arrange
        var factory = new EventHandlerAdapterFactory(_mockLogger);
        Type handlerType = typeof(EventHandlerMock); 
        Type handlerInterface = typeof(IEventHandler<EventMock>); 

        // Act
        var descriptions = factory.GetMessageHandlerDescriptions(handlerType, handlerInterface).ToList();

        // Assert
        descriptions.Should().HaveCount(1);
        var description = descriptions[0];
        description.Key.Should().Be($"{handlerType.FullName}-{typeof(EventMock).FullName}");
        description.HandlerType.Should().Be(handlerType);
        description.MessageType.Should().Be(typeof(EventMock));
        description.InterfaceType.Should().Be(handlerInterface);
        description.ReturnType.Should().Be(typeof(Unit));
        description.Method.Should().NotBeNull();
        description.Method!.Name.Should().Be(nameof(EventHandlerMock.HandleAsync));
    }

    private class EventHandlerMock : IEventHandler<EventMock>
    {
        public Task<Either<Exception, Unit>> HandleAsync(EventMock message, IMessageContext messageContext, CancellationToken cancellationToken)
        {
            throw new NotImplementedException();
        }
    }

    private record EventMock : Event { }
}
