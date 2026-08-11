using LanguageExt;
using NEvo.Ddd.EventSourcing.Deciding;
using NEvo.Ddd.EventSourcing.Executing;
using NEvo.Messaging.Context;
using NEvo.Messaging.Cqrs.Commands;
using NEvo.Messaging.Events;

namespace NEvo.Ddd.EventSourcing.Tests;

// DeciderCommandHandler's own remaining responsibility, post task-03 executor
// extraction, is decider resolution and delegating to IEventSourcedCommandExecutor —
// load/append/version-mapping is the executor's own responsibility now, covered by
// Characterization/EventSourcedCommandExecutorTests.cs instead.
public class DeciderCommandHandlerTests
{
    [Fact]
    public async Task HandleAsync_WhenDeciderFound_DelegatesToExecutorWithACommandMatchingDecideFunction()
    {
        // Arrange
        var deciderRegistryMock = new Mock<IDeciderRegistry>();
        var executorMock = new Mock<IEventSourcedCommandExecutor>();
        var authorization = new NoOpAggregateAuthorization<MockCommand, MockAggregate, int>();
        var contextMock = new Mock<IMessageContext>();
        var deciderMock = new Mock<IDecider>();
        var command = new MockCommand(1);
        var aggregateOption = Option<MockAggregate>.Some(new MockAggregate(1));
        MockEvent[] events = [new MockEvent(1)];

        deciderRegistryMock.Setup(dr => dr.GetDecider<MockCommand, MockAggregate, int>(command))
            .Returns(Option<IDecider>.Some(deciderMock.Object));

        deciderMock.Setup(d => d.DecideAsync(aggregateOption, command, It.IsAny<CancellationToken>()))
            .Returns((EitherAsync<Exception, IEnumerable<IAggregateEvent<MockAggregate, int>>>)events);

        Func<Option<MockAggregate>, EitherAsync<Exception, IEnumerable<IAggregateEvent<MockAggregate, int>>>>? capturedDecide = null;
        executorMock.Setup(e => e.ExecuteAsync(
                command,
                contextMock.Object,
                authorization,
                It.IsAny<Func<Option<MockAggregate>, EitherAsync<Exception, IEnumerable<IAggregateEvent<MockAggregate, int>>>>>(),
                It.IsAny<CancellationToken>()))
            .Callback<MockCommand, IMessageContext, IAggregateAuthorization<MockCommand, MockAggregate, int>, Func<Option<MockAggregate>, EitherAsync<Exception, IEnumerable<IAggregateEvent<MockAggregate, int>>>>, CancellationToken>(
                (_, _, _, decide, _) => capturedDecide = decide)
            .Returns(Unit.Default);

        var sut = new DeciderCommandHandler<MockCommand, MockAggregate, int>(deciderRegistryMock.Object, executorMock.Object, authorization);

        // Act
        var result = await sut.HandleAsync(command, contextMock.Object, CancellationToken.None);

        // Assert
        result.Should().BeRight();
        capturedDecide.Should().NotBeNull();
        var decideResult = await capturedDecide!(aggregateOption);
        decideResult.Should().BeRight().Which.Should().BeEquivalentTo(events);
    }

    [Fact]
    public async Task HandleAsync_WhenNoDeciderFound_ShouldReturnErrorWithoutInvokingExecutor()
    {
        // Arrange
        var deciderRegistryMock = new Mock<IDeciderRegistry>();
        var executorMock = new Mock<IEventSourcedCommandExecutor>();
        var authorization = new NoOpAggregateAuthorization<MockCommand, MockAggregate, int>();
        var contextMock = new Mock<IMessageContext>();
        var command = new MockCommand(1);

        deciderRegistryMock.Setup(dr => dr.GetDecider<MockCommand, MockAggregate, int>(command))
            .Returns(Option<IDecider>.None);

        var sut = new DeciderCommandHandler<MockCommand, MockAggregate, int>(deciderRegistryMock.Object, executorMock.Object, authorization);

        // Act
        var result = await sut.HandleAsync(command, contextMock.Object, CancellationToken.None);

        // Assert
        result.Should().BeLeft()
            .Which.Message.Should().Be("No decider found for command MockCommand");
        executorMock.Verify(e => e.ExecuteAsync(
            It.IsAny<MockCommand>(),
            It.IsAny<IMessageContext>(),
            It.IsAny<IAggregateAuthorization<MockCommand, MockAggregate, int>>(),
            It.IsAny<Func<Option<MockAggregate>, EitherAsync<Exception, IEnumerable<IAggregateEvent<MockAggregate, int>>>>>(),
            It.IsAny<CancellationToken>()
        ), Times.Never);
    }

    public class MockAggregate(int id) : IAggregateRoot<int>
    {
        public int Id { get; set; } = id;
    }

    public record MockEvent(int StreamId) : Event, IAggregateEvent<MockAggregate, int>;
    public record MockCommand(int StreamId) : Command, IAggregateCommand<MockAggregate, int>;
    public record MockCreateCommand(int StreamId) : MockCommand(StreamId), ICreateAggregateCommand<MockAggregate, int>;
}
