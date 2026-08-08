using LanguageExt;
using NEvo.Messaging.Context;
using NEvo.Messaging.Cqrs.Commands;
using NEvo.Messaging.Handling;

namespace NEvo.Messaging.Cqrs.Tests.Commands;

public class CommandHandlerAdapterTests
{
    private readonly Mock<IServiceProvider> _serviceProviderMock;
    private readonly Mock<IMessageContext> _messageContextMock;
    private readonly Mock<IService> _serviceMock;
    private readonly MessageHandlerDescription _messageHandlerDescription;

    public CommandHandlerAdapterTests()
    {
        _serviceProviderMock = new Mock<IServiceProvider>();
        _messageContextMock = new Mock<IMessageContext>();
        _serviceMock = new Mock<IService>();
        _serviceProviderMock.Setup(sp => sp.GetService(typeof(IService)))
            .Returns(_serviceMock.Object);

        _messageHandlerDescription = new MessageHandlerDescription(
            "Key",
            typeof(CommandHandlerMock),
            typeof(Command),
            typeof(ICommandHandler<>)
        );
        _messageContextMock.SetupGet(ctx => ctx.ServiceProvider).Returns(_serviceProviderMock.Object);
    }

    [Fact]
    public async Task HandleAsync_CallsCommandHandler_AndReturnsSuccess()
    {
        // Arrange
        var mockCommand = new Command();
        var cancellationToken = new CancellationToken();
        var adapter = new CommandHandlerAdapter(_messageHandlerDescription);
        _serviceMock.Setup(m => m.HandleAsync(mockCommand, _messageContextMock.Object, cancellationToken))
            .Returns(Task.FromResult(Either<Exception, Unit>.Right(Unit.Default)));

        // Act
        var result = await adapter.HandleAsync(mockCommand, _messageContextMock.Object, cancellationToken);

        // Assert
        result.Should().BeRight().Which.Should().Be(Unit.Default);
        _serviceMock
            .Verify(m => m.HandleAsync(mockCommand, _messageContextMock.Object, cancellationToken), Times.Once);
    }

    [Fact]
    public async Task HandleAsync_ReturnsException_WhenHandlerThrows()
    {
        // Arrange
        var mockCommand = new Command();
        var cancellationToken = new CancellationToken();
        var exception = new Exception();
        var adapter = new CommandHandlerAdapter(_messageHandlerDescription);
        _serviceMock.Setup(m => m.HandleAsync(mockCommand, _messageContextMock.Object, cancellationToken))
            .ThrowsAsync(exception);

        // Act
        var result = await adapter.HandleAsync(mockCommand, _messageContextMock.Object, cancellationToken);

        // Assert
        result.Should().BeLeft().Which.Should().BeSameAs(exception);
    }

    [Fact]
    public async Task HandleAsync_ReturnsExactExceptionInstance_WhenHandlerThrowsSynchronouslyBeforeReturningTask()
    {
        // Arrange
        var mockCommand = new Command();
        var cancellationToken = new CancellationToken();
        var exception = new Exception();
        var adapter = new CommandHandlerAdapter(_messageHandlerDescription);
        _serviceMock.Setup(m => m.HandleAsync(mockCommand, _messageContextMock.Object, cancellationToken))
            .Throws(exception);

        // Act
        var result = await adapter.HandleAsync(mockCommand, _messageContextMock.Object, cancellationToken);

        // Assert
        result.Should().BeLeft().Which.Should().BeSameAs(exception);
    }

    public interface IService
    {
        Task<Either<Exception, Unit>> HandleAsync(Command message, IMessageContext messageContext, CancellationToken cancellationToken);
    }

    private class CommandHandlerMock(IService service) : ICommandHandler<Command>
    {
        public Task<Either<Exception, Unit>> HandleAsync(Command message, IMessageContext messageContext, CancellationToken cancellationToken)
            => service.HandleAsync(message, messageContext, cancellationToken);
    }
}
