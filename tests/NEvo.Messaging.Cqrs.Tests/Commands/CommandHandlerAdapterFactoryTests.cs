using LanguageExt;
using NEvo.Messaging.Context;
using NEvo.Messaging.Cqrs.Commands;
using NEvo.Messaging.Handling;

namespace NEvo.Messaging.Cqrs.Tests.Commands;

public class CommandHandlerAdapterFactoryTests
{
    [Fact]
    public void ForInterface_ShouldReturnICommandHandlerGenericType()
    {
        // Arrange
        var factory = new CommandHandlerAdapterFactory();

        // Act
        var forInterface = factory.ForInterface;

        // Assert
        forInterface.Should().Be(typeof(ICommandHandler<>));
    }

    [Fact]
    public void Create_ShouldReturnCommandHandlerAdapter()
    {
        // Arrange
        var factory = new CommandHandlerAdapterFactory();
        var description = new MessageHandlerDescription(
            "Key",
            typeof(CommandHandlerMock),
            typeof(CommandMock),
            typeof(ICommandHandler<>)
        );

        // Act
        var handler = factory.Create(description);

        // Assert
        handler.Should().BeOfType<CommandHandlerAdapter>();
    }

    [Fact]
    public void GetMessageHandlerDescriptions_ShouldYieldCorrectDescription()
    {
        // Arrange
        var factory = new CommandHandlerAdapterFactory();
        Type handlerType = typeof(CommandHandlerMock);
        Type handlerInterface = typeof(ICommandHandler<CommandMock>);

        // Act
        var descriptions = factory.GetMessageHandlerDescriptions(handlerType, handlerInterface).ToList();

        // Assert
        descriptions.Should().HaveCount(1);
        var description = descriptions[0];
        description.Key.Should().Be($"{handlerType.FullName}-{typeof(CommandMock).FullName}");
        description.HandlerType.Should().Be(handlerType);
        description.MessageType.Should().Be(typeof(CommandMock));
        description.InterfaceType.Should().Be(handlerInterface);
        description.ReturnType.Should().Be(typeof(Unit));
        description.Method.Should().NotBeNull();
        description.Method!.Name.Should().Be(nameof(CommandHandlerMock.HandleAsync));
    }

    private class CommandHandlerMock : ICommandHandler<CommandMock>
    {
        public Task<Either<Exception, Unit>> HandleAsync(CommandMock message, IMessageContext messageContext, CancellationToken cancellationToken)
        {
            throw new NotImplementedException();
        }
    }

    private record CommandMock : Command { }
}
