using LanguageExt;
using NEvo.Ddd.EventSourcing.Deciding;
using NEvo.Messaging.Cqrs.Commands;
using NEvo.Messaging.Events;

namespace NEvo.Ddd.EventSourcing.Tests;

public class DeciderCommandHandlerTests
{
    [Fact]
    public async Task HandleAsync_WhenAggregateAndDeciderFound_ShouldAppendNewEvents()
    {
        // Arrange
        var deciderRegistryMock = new Mock<IDeciderRegistry>();
        var eventStoreMock = new Mock<IEventStore>();
        var deciderMock = new Mock<IDecider>();
        var command = new MockCommand(1);
        var aggregate = new MockAggregate(1);
        MockEvent[] events = [new MockEvent(1)];

        deciderRegistryMock.Setup(dr => dr.GetDecider<MockCommand, MockAggregate, int>(command))
            .Returns(Option<IDecider>.Some(deciderMock.Object));

        eventStoreMock.Setup(es => es.LoadAggregateAsync<MockAggregate, int>(command.StreamId, It.IsAny<CancellationToken>()))
            .Returns(OptionAsync<MockAggregate>.Some(aggregate));

        deciderMock.Setup(d => d.DecideAsync(aggregate, command, It.IsAny<CancellationToken>()))
            .Returns((EitherAsync<Exception, IEnumerable<IAggregateEvent<MockAggregate, int>>>)events);

        eventStoreMock.Setup(es => es.AppendEventsAsync(aggregate.Id, events, It.IsAny<CancellationToken>()))
            .Returns(Task.FromResult(Unit.Default));

        var sut = new DeciderCommandHandler(deciderRegistryMock.Object, eventStoreMock.Object);

        // Act
        var result = await sut.HandleAsync<MockCommand, MockAggregate, MockEvent, int>(command, CancellationToken.None);

        // Assert
        result.Should().BeRight();
        eventStoreMock.Verify(es => es.AppendEventsAsync(aggregate.Id, events, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task HandleAsync_WhenNoDeciderFound_ShouldReturnError()
    {
        // Arrange
        var deciderRegistryMock = new Mock<IDeciderRegistry>();
        var eventStoreMock = new Mock<IEventStore>();
        var command = new MockCommand(1);

        deciderRegistryMock.Setup(dr => dr.GetDecider<MockCommand, MockAggregate, int>(command))
            .Returns(Option<IDecider>.None);

        var sut = new DeciderCommandHandler(deciderRegistryMock.Object, eventStoreMock.Object);

        // Act
        var result = await sut.HandleAsync<MockCommand, MockAggregate, MockEvent, int>(command, CancellationToken.None);

        // Assert
        result.Should().BeLeft()
            .Which.Message.Should().Be("No decider found for command MockCommand");
    }

    [Fact]
    public async Task HandleAsync_WhenAggregateNotFound_ShouldReturnError()
    {
        // Arrange
        var deciderRegistryMock = new Mock<IDeciderRegistry>();
        var eventStoreMock = new Mock<IEventStore>();
        var deciderMock = new Mock<IDecider>();
        var command = new MockCommand(1);

        deciderRegistryMock.Setup(dr => dr.GetDecider<MockCommand, MockAggregate, int>(command))
            .Returns(Option<IDecider>.Some(deciderMock.Object));

        eventStoreMock.Setup(es => es.LoadAggregateAsync<MockAggregate, int>(command.StreamId, It.IsAny<CancellationToken>()))
            .Returns(OptionAsync<MockAggregate>.None);

        var sut = new DeciderCommandHandler(deciderRegistryMock.Object, eventStoreMock.Object);

        // Act
        var result = await sut.HandleAsync<MockCommand, MockAggregate, MockEvent, int>(command, CancellationToken.None);

        // Assert
        result.Should().BeLeft()
            .Which.Message.Should().Be("No aggregate found for command MockCommand");
    }

    [Fact]
    public async Task HandleAsync_WhenAggregateNotFoundButCommandIsCreateCommand_ShouldAppendNewEvents()
    {
        // Arrange
        int aggregateId = 1;
        var deciderRegistryMock = new Mock<IDeciderRegistry>();
        var eventStoreMock = new Mock<IEventStore>();
        var deciderMock = new Mock<IDecider>();
        var command = new MockCreateCommand(aggregateId);
        MockEvent[] events = [new MockEvent(aggregateId)];

        deciderRegistryMock.Setup(dr => dr.GetDecider<MockCommand, MockAggregate, int>(command))
            .Returns(Option<IDecider>.Some(deciderMock.Object));

        eventStoreMock.Setup(es => es.LoadAggregateAsync<MockAggregate, int>(command.StreamId, It.IsAny<CancellationToken>()))
            .Returns(OptionAsync<MockAggregate>.None);

        deciderMock.Setup(d => d.DecideAsync(It.IsAny<MockAggregate>(), command, It.IsAny<CancellationToken>()))
            .Returns((EitherAsync<Exception, IEnumerable<IAggregateEvent<MockAggregate, int>>>)events);

        eventStoreMock.Setup(es => es.AppendEventsAsync(aggregateId, events, It.IsAny<CancellationToken>()))
            .Returns(Task.FromResult(Unit.Default));

        var sut = new DeciderCommandHandler(deciderRegistryMock.Object, eventStoreMock.Object);

        // Act
        var result = await sut.HandleAsync<MockCommand, MockAggregate, MockEvent, int>(command, CancellationToken.None);

        // Assert
        result.Should().BeRight();
        eventStoreMock.Verify(es => es.AppendEventsAsync(aggregateId, events, It.IsAny<CancellationToken>()), Times.Once);
    }

    public class MockAggregate(int id) : IAggregateRoot<int, MockAggregate>
    {
        public int Id { get; set; } = id;
        public static MockAggregate CreateEmpty(int id) => new(id);
    }

    public record MockEvent(int StreamId) : Event, IAggregateEvent<MockAggregate, int>;
    public record MockCommand(int StreamId) : Command, IAggregateCommand<MockAggregate, int>;
    public record MockCreateCommand(int StreamId) : MockCommand(StreamId), ICreateAggregateCommand<MockAggregate, int>;
}
