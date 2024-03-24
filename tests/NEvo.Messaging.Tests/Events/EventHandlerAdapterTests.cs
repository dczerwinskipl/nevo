using LanguageExt;
using Microsoft.Extensions.Logging;
using NEvo.Core;
using NEvo.Messaging.Context;
using NEvo.Messaging.Events;
using NEvo.Messaging.Handling;

namespace NEvo.Messaging.Tests.Events;

public class EventHandlerAdapterTests
{
    private readonly Mock<ILogger<EventHandlerAdapter>> _loggerMock;
    private readonly Mock<IServiceProvider> _serviceProviderMock;
    private readonly Mock<IMessageContext> _messageContextMock;
    private readonly Mock<IService> _serviceMock;
    private readonly MessageHandlerDescription _messageHandlerDescription;

    public EventHandlerAdapterTests()
    {
        _loggerMock = new Mock<ILogger<EventHandlerAdapter>>();
        _serviceProviderMock = new Mock<IServiceProvider>();
        _messageContextMock = new Mock<IMessageContext>();
        _serviceMock = new Mock<IService>();
        _serviceProviderMock.Setup(sp => sp.GetService(typeof(IService)))
            .Returns(_serviceMock.Object);

        _messageHandlerDescription = new MessageHandlerDescription(
            "Key",
            typeof(EventHandlerMock),
            typeof(Event),
            typeof(IEventHandler<>)
        );
        _messageContextMock.SetupGet(ctx => ctx.ServiceProvider).Returns(_serviceProviderMock.Object);
    }

    [Fact]
    public async Task HandleAsync_CallsEventHandler_AndReturnsSuccess()
    {
        // Arrange
        var expectedResult = UnitExt.DefaultEitherTask;
        var mockEvent = new Event();
        var cancellationToken = new CancellationToken();
        var adapter = new EventHandlerAdapter(_messageHandlerDescription, _loggerMock.Object);
        _serviceMock.Setup(m => m.HandleAsync(mockEvent, _messageContextMock.Object, cancellationToken))
            .Returns(expectedResult);

        // Act
        var result = await adapter.HandleAsync(mockEvent, _messageContextMock.Object, cancellationToken);

        // Assert
        result.ExpectRight().Should().Be(Unit.Default);
        _serviceMock
            .Verify(m => m.HandleAsync(mockEvent, _messageContextMock.Object, cancellationToken), Times.Once);
    }

    [Fact]
    public async Task HandleAsync_ReturnsException_OnFailure()
    {
        // Arrange
        var mockEvent = new Event();
        var cancellationToken = new CancellationToken();
        var exception = new Exception();
        var adapter = new EventHandlerAdapter(_messageHandlerDescription, _loggerMock.Object);
        _serviceMock.Setup(m => m.HandleAsync(mockEvent, _messageContextMock.Object, cancellationToken))
            .ThrowsAsync(exception);

        // Act
        var result = await adapter.HandleAsync(mockEvent, _messageContextMock.Object, cancellationToken);

        // Assert
        result.ExpectLeft().Should().Be(exception);
    }


    public interface IService
    {
        Task<Either<Exception, Unit>> HandleAsync(Event message, IMessageContext messageContext, CancellationToken cancellationToken);
    }

    private class EventHandlerMock(IService serivce) : IEventHandler<Event>
    {
        public Task<Either<Exception, Unit>> HandleAsync(Event message, IMessageContext messageContext, CancellationToken cancellationToken)
            => serivce.HandleAsync(message, messageContext, cancellationToken);
    }
}