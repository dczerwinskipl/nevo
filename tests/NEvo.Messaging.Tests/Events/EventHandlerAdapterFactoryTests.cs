using LanguageExt;
using Microsoft.Extensions.Logging;
using NEvo.Messaging.Context;
using NEvo.Messaging.Events;
using NEvo.Messaging.Handling;

namespace NEvo.Messaging.Tests.Events;

public class EventHandlerAdapterFactoryTests
{
    private readonly ILogger<MessageHandlerAdapter> _mockLogger;

    public EventHandlerAdapterFactoryTests()
    {
        _mockLogger = Mock.Of<ILogger<MessageHandlerAdapter>>();
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
    public void Create_ShouldReturnMessageHandlerAdapter()
    {
        // Arrange
        var factory = new EventHandlerAdapterFactory(_mockLogger);
        var description = new MessageHandlerDescription(
            "Key",
            typeof(EventHandlerMock),
            typeof(EventMock),
            typeof(IEventHandler<>),
            ReturnType: typeof(Unit),
            Method: typeof(EventHandlerMock).GetMethod(nameof(EventHandlerMock.HandleAsync))
        );

        // Act
        var handler = factory.Create(description);

        // Assert
        handler.Should().BeOfType<MessageHandlerAdapter>();
        (handler as MessageHandlerAdapter).Should().NotBeNull();
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

    [Fact]
    public async Task GetMessageHandlerDescriptions_And_Dispatch_WorkWithExplicitInterfaceImplementation()
    {
        // Arrange
        var factory = new EventHandlerAdapterFactory(_mockLogger);
        Type handlerType = typeof(ExplicitEventHandlerMock);
        Type handlerInterface = typeof(IEventHandler<EventMock>);
        var serviceProviderMock = new Mock<IServiceProvider>();
        var messageContextMock = new Mock<IMessageContext>();
        messageContextMock.SetupGet(ctx => ctx.ServiceProvider).Returns(serviceProviderMock.Object);

        // Act – factory resolution
        var descriptions = factory.GetMessageHandlerDescriptions(handlerType, handlerInterface).ToList();
        descriptions.Should().HaveCount(1);
        var adapter = factory.Create(descriptions[0]);

        // Act – dispatch
        var result = await adapter.HandleAsync(new EventMock(), messageContextMock.Object, CancellationToken.None);

        // Assert
        result.ExpectRight().Should().Be(Unit.Default);
    }

    private class EventHandlerMock : IEventHandler<EventMock>
    {
        public Task<Either<Exception, Unit>> HandleAsync(EventMock message, IMessageContext messageContext, CancellationToken cancellationToken)
        {
            throw new NotImplementedException();
        }
    }

    private class ExplicitEventHandlerMock : IEventHandler<EventMock>
    {
        Task<Either<Exception, Unit>> IEventHandler<EventMock>.HandleAsync(EventMock message, IMessageContext messageContext, CancellationToken cancellationToken)
            => Task.FromResult(Either<Exception, Unit>.Right(Unit.Default));
    }

    private record EventMock : Event { }
}
