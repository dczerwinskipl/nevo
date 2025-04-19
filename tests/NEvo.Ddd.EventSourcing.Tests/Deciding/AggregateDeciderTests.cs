using LanguageExt;
using NEvo.Ddd.EventSourcing.Deciding;
using NEvo.Messaging.Cqrs.Commands;
using NEvo.Messaging.Events;

namespace NEvo.Ddd.EventSourcing.Tests.Deciding;

public class AggregateDeciderTests
{

    [Fact]
    public async Task DecideAsync_WhenCalledWithCommandAvailableForAggregateState_ShouldReturnNewEvents()
    {
        // arrange
        var aggregate = MockBaseAggregate.CreateEmpty(Guid.NewGuid());
        var decider = new AggregateDecider([typeof(MockBaseAggregate)]);

        // act
        var result = await decider.DecideAsync<CreateMockAggregate, MockBaseAggregate, MockAggregateEvent, Guid>(
            new CreateMockAggregate(aggregate.Id),
            aggregate,
            CancellationToken.None
        );

        // assert
        result.Should().BeRight().Which
            .Should().BeEquivalentTo(
                [new MockAggregateCreated(aggregate.Id)],
                options => options.Excluding(e => e.Id).Excluding(e => e.CreatedAt)
            );
    }

    [Fact]
    public async Task DecideAsync_WhenCalledWithCommandNotAvailableForAggregateStatae_ShouldReturnError()
    {
        // arrange
        var aggregate = MockBaseAggregate.CreateEmpty(Guid.NewGuid());
        var decider = new AggregateDecider([typeof(MockBaseAggregate)]);

        // act
        var result = await decider.DecideAsync<ChangeMockAggregate, MockBaseAggregate, MockAggregateEvent, Guid>(
            new ChangeMockAggregate(aggregate.Id),
            aggregate,
            CancellationToken.None
        );

        // assert
        result.Should().BeLeft().Which
            .Should().BeOfType<Exception>().Which
            .Message.Should().Contain("No decider found for command ChangeMockAggregate on aggregate EmptyMockAggregate");
    }


    public record CreateMockAggregate(Guid StreamId) : Command, ICreateAggregateCommand<MockBaseAggregate, Guid>;
    public record ChangeMockAggregate(Guid StreamId) : Command, IAggregateCommand<MockBaseAggregate, Guid>;

    public abstract record MockAggregateEvent(Guid StreamId) : Event, IAggregateEvent<MockBaseAggregate, Guid>;
    public record MockAggregateCreated(Guid StreamId) : MockAggregateEvent(StreamId);
    public record MockAggregateChanged(Guid StreamId) : MockAggregateEvent(StreamId);

    public abstract class MockBaseAggregate(Guid id) : IAggregateRoot<Guid, MockBaseAggregate>
    {
        public Guid Id => id;

        public static MockBaseAggregate CreateEmpty(Guid id) => new EmptyMockAggregate(id);
    }

    public class EmptyMockAggregate(Guid id) : MockBaseAggregate(id)
    {
        public Either<Exception, IEnumerable<MockAggregateEvent>> Create(CreateMockAggregate command)
        {
            return new[] { new MockAggregateCreated(Id) };
        }
    }

    public class MockAggregate(Guid id) : MockBaseAggregate(id)
    {
        public Either<Exception, IEnumerable<MockAggregateEvent>> Change(ChangeMockAggregate command)
        {
            return new[] { new MockAggregateChanged(Id) };
        }
    }
}
