using LanguageExt;

namespace NEvo.Core;

public static class UnitExt
{
    public static readonly Task<Either<Exception, Unit>> DefaultEitherTask = Task.FromResult(Either<Exception, Unit>.Right(Unit.Default));
}
